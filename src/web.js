// ADR-5 fallback surface: the same pipeline, reached over HTTP instead of WhatsApp.
//
// Layers 1-3 are channel-agnostic by design, so this file is pure transport. It adds
// no validation, no business rules and no prompts of its own - it calls exactly the
// same extractor, rulebook and PDF generator the WhatsApp path uses.
//
// If the WhatsApp transport lands later, nothing here needs to change or be removed.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractDocument, classifyDocument, VLM_MODEL } from './extractor.js';
import { validateEWS, validateDocument, toAsciiDigits, resolveNames } from './rulebook.js';
import { generateEWSForm } from './pdf.js';
import { t } from './i18n/index.js';
import { REVIEW_FIELDS } from './review.js';
import { listClients, getProfile, warmAll, setOverride } from './clients.js';
import { LANGUAGES } from './i18n/index.js';
import { lookupKey, count as countUsage, usage, myUsage } from './keys.js';
import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs, findCurated } from './fieldmap.js';

export const web = express.Router();

// CORS: only the extension's service worker (a chrome-extension:// origin) is allowed in.
// Same-origin pages (the demo portal, the usage page) need no CORS headers at all.
web.use((req, res, next) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// API keys: paid actions need X-Api-Key and are counted per key per day (2xx responses only).
// [method, path pattern, usage type]; type null = key required but not counted (citizen data).
const KEYED = [
  ['POST', /^\/api\/check-upload$/, 'document'],
  ['POST', /^\/api\/extract$/, 'document'],
  ['POST', /^\/api\/check-names$/, 'names'],
  ['POST', /^\/api\/validate$/, 'validation'],
  ['GET', /^\/api\/clients\/[^/]+\/validate$/, 'validation'],
  ['POST', /^\/api\/stt$/, 'voice'],
  ['POST', /^\/api\/to-pdf$/, 'convert'],
  ['POST', /^\/api\/pdf$/, 'convert'],
  ['POST', /^\/api\/fill$/, 'fill'],
  ['GET', /^\/api\/my-usage$/, null],
  ['*', /^\/api\/clients(\/|$)/, null],
  ['GET', /^\/api\/whoami$/, null],
];
web.use((req, res, next) => {
  const rule = KEYED.find(([m, re]) => (m === '*' || m === req.method) && re.test(req.path));
  if (!rule) return next();
  const key = req.get('X-Api-Key');
  if (!key) return res.status(401).json({ ok: false, error: 'api_key_missing' });
  const rec = lookupKey(key);
  if (!rec) return res.status(401).json({ ok: false, error: 'api_key_invalid' });
  req.csc = { key, name: rec.name };
  const type = rule[2];
  if (type) res.on('finish', () => { if (res.statusCode >= 200 && res.statusCode < 300) countUsage(key, type); });
  next();
});

// Dev auto-reload: newest mtime among files directly in extension/ and extension/vendor/. Free (not in KEYED).
const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
let extVer = { t: 0, v: '0' };
web.get('/dev/ext-version', (_req, res) => {
  const now = Date.now();
  if (now - extVer.t > 1000) {
    let newest = 0;
    for (const dir of [EXT_DIR, path.join(EXT_DIR, 'vendor')]) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* missing dir */ }
      for (const n of names) {
        try { const s = fs.statSync(path.join(dir, n)); if (s.isFile() && s.mtimeMs > newest) newest = s.mtimeMs; } catch { /* skip */ }
      }
    }
    extVer = { t: now, v: String(newest) };
  }
  res.json({ v: extVer.v });
});

web.get('/api/whoami', (req, res) => res.json({ ok: true, name: req.csc.name }));

/** Admin view of per-key usage. ADMIN_KEY comes from the environment (server.js loads .env). */
web.get('/api/usage', (req, res) => {
  const admin = process.env.ADMIN_KEY;
  if (!admin) return res.status(503).json({ ok: false, error: 'admin_key_not_set' });
  if (req.get('X-Admin-Key') !== admin) return res.status(401).json({ ok: false, error: 'admin_key_invalid' });
  res.json({ ok: true, rows: usage() });
});

/** Every static list a curated form's mrLookup refers to, by name. */
function staticLists(curated) {
  const out = {};
  for (const l of Object.values(curated.mrLookup || {})) if (l.static && curated[l.static]) out[l.static] = curated[l.static];
  return out;
}

web.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

/** Which fields the review step exposes, so the page never hardcodes them. */
web.get('/api/fields', (req, res) => {
  const lang = req.query.lang || 'en';
  res.json(REVIEW_FIELDS.map((f) => ({
    id: f.id,
    label: t(lang, f.label),
    path: f.path,
    latinPath: f.latinPath || null,
  })));
});

/** Layer 1. Same model, same prompts, same sanitiser as the WhatsApp path. */
web.post('/api/extract', async (req, res) => {
  const { docType, imageBase64 } = req.body || {};
  if (!docType || !imageBase64) {
    return res.status(400).json({ error: 'docType and imageBase64 are required' });
  }

  const buffer = Buffer.from(imageBase64.replace(/^data:[^,]+,/, ''), 'base64');
  const started = Date.now();

  try {
    const data = await extractDocument(buffer, docType);
    res.json({ ok: true, data, elapsed: ((Date.now() - started) / 1000).toFixed(1) });
  } catch (err) {
    console.error('[web/extract]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Layer 2. Errors come back already rendered in the chosen language. */
web.post('/api/validate', (req, res) => {
  const { profile, lang = 'en' } = req.body || {};
  if (!profile) return res.status(400).json({ error: 'profile is required' });

  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
});

/**
 * Layer 3. Validation is re-run server-side: the page cannot talk its way past the
 * rulebook by posting a profile straight here.
 */
web.post('/api/pdf', async (req, res) => {
  const { profile, lang = 'en' } = req.body || {};
  if (!profile) return res.status(400).json({ error: 'profile is required' });

  const result = validateEWS(profile);
  if (!result.ok) {
    return res.status(422).json({
      ok: false,
      errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
      missing: result.missing,
    });
  }

  try {
    const pdf = await generateEWSForm(profile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="EWS_Application.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('[web/pdf]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Panel strings. Reuses the existing catalogs so the extension is multilingual (PS). */
web.get('/api/strings', (req, res) => {
  const lang = LANGUAGES.includes(req.query.lang) ? req.query.lang : 'en';
  const keys = [
    'f_name', 'f_dob', 'f_address', 'f_income', 'f_survey', 'f_purpose',
    'all_clear', 'blurry_retry', 'listening', 'heard', 'voice_failed', 'voice_empty',
    'panel_title', 'panel_client', 'panel_validate', 'panel_fill', 'panel_voice', 'panel_convert',
    'panel_incomplete', 'panel_no_service', 'panel_no_client', 'panel_filled', 'panel_record',
    'panel_stop', 'panel_insert', 'panel_format', 'panel_maxsize',
    'panel_click_field', 'panel_inserted', 'panel_choose_image', 'panel_pdf_failed', 'panel_fill_failed', 'panel_done_kb',
    'land_operator_entry', 'panel_operator_field', 'panel_check_figure', 'panel_fill_nothing',
    'name_unreadable', 'upload_checking', 'upload_ok', 'upload_unknown_doc', 'upload_format_bad',
    'pop_upload', 'pop_summary', 'pop_listening', 'pop_to_text', 'pop_to_pages', 'pop_convert',
    'pop_compress', 'pop_choose_client', 'pop_no_option', 'panel_verify_field', 'pop_not_curated',
    'pop_not_a_name', 'pop_api_key',
    'feat_fill', 'feat_voice', 'feat_convert', 'feat_compress', 'panel_pick_feature', 'voice_click_target', 'panel_hide',
  ];
  res.json(Object.fromEntries(keys.map((k) => [k, t(lang, k)])));
});

web.get('/api/clients', async (_req, res) => {
  try {
    res.json(await listClients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

web.get('/api/clients/:key/profile', async (req, res) => {
  const profile = await getProfile(req.params.key);
  res.json(profile);
});

web.get('/api/clients/:key/validate', async (req, res) => {
  const lang = LANGUAGES.includes(req.query.lang) ? req.query.lang : 'en';
  const profile = await getProfile(req.params.key);
  // A12 (#124): judge every document present, even when another is missing. validateEWS
  // supplies completeness and the all-three checks; validateDocument adds per-document and
  // pairwise checks. Duplicates (same key and params) are reported once.
  const full = validateEWS(profile);
  const seen = new Set();
  const errors = [];
  const notices = [];
  const add = (list, items) => {
    for (const e of items || []) {
      const k = JSON.stringify([e.key, e.params]);
      if (!seen.has(k)) { seen.add(k); list.push(e); }
    }
  };
  add(errors, full.errors);
  add(notices, full.notices);
  for (const type of ['identity', 'income', 'land']) {
    if (!profile[type]) continue;
    const r = validateDocument(type, profile[type], { profile });
    add(errors, r.errors);
    add(notices, r.notices);
  }
  const result = { ...full, errors, notices };
  // Phase 12: purpose is on no document and the portal collects it itself.
  const missing = result.missing.filter((m) => m !== 'purpose');
  res.json({
    ok: result.errors.length === 0 && missing.length === 0,
    missing,
    missing_message: missing.length
      ? t(lang, 'panel_missing', { list: missing.map((m) => t(lang, `doc_${m}`)).join(', ') })
      : null,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
    notices: (result.notices || []).map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
});

/** Re-scan the MASTER directory and extract anything new. */
web.post('/api/clients/refresh', async (_req, res) => {
  try {
    await warmAll();
    res.json({ ok: true, clients: await listClients() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

web.post('/api/clients/:key/override', async (req, res) => {
  const { path: p, value } = req.body || {};
  try { await setOverride(req.params.key, p, value); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/**
 * D5: the extension posts every field it found; we return what to put in each.
 * Body: { client, url, fields: [{ ref, label, name, id, placeholder, type }] }
 * Returns: { values: { ref: value }, matched: n, total: n }
 */
web.post('/api/fill', async (req, res) => {
  const { client, url, fields } = req.body || {};
  if (!client || !Array.isArray(fields)) {
    return res.status(400).json({ error: 'client and fields are required' });
  }

  const profile = await getProfile(client);
  // A13 (R5): curated forms only. An uncurated page is never guessed at.
  if (!findCurated(url)) {
    return res.json({ curated: false, values: {}, operator: [], chains: [], hints: {}, verify: [], matched: 0, total: fields.length });
  }
  const values = matchFields({ profile, url, fields });
  const curatedForm = findCurated(url);
  res.json({
    overrides: { fields: curatedForm.operatorPaths || {}, area: curatedForm.areaFields || null },
    values,
    operator: operatorRefs({ profile, url, fields }),
    chains: selectChains({ profile, url }),
    hints: hintRefs({ profile, url, fields }),
    verify: verifyRefs({ profile, url, fields }),
    mrLookup: curatedForm.mrLookup || {},
    districtsMr: curatedForm.districtsMr || {},
    lists: staticLists(curatedForm),
    matched: Object.keys(values).length,
    total: fields.length,
  });
});

/** Proxy to the local STT service so the extension needs only one origin. */
const STT_EXAMPLES = {
  en: 'Ramesh Shinde, Sunita Pawar, Rahul Deshmukh, Pooja Kulkarni, Vijay Jadhav, Anjali Gaikwad',
  mr: 'रमेश शिंदे, सुनीता पवार, राहुल देशमुख, पूजा कुलकर्णी, विजय जाधव, अंजली गायकवाड',
  hi: 'रमेश शर्मा, सुनीता वर्मा, राहुल सिंह, पूजा गुप्ता, विजय यादव, अंजली मिश्रा',
};
const STT_LEAD = {
  en: "An Indian person's full name, for example:",
  mr: 'व्यक्तीचे पूर्ण नाव, उदाहरणार्थ:',
  hi: 'व्यक्ति का पूरा नाम, उदाहरण:',
};
/** ADR-8: the output script belongs to the form, so the field label picks the language. */
export function fieldLanguage(field) {
  const s = String(field || '');
  if (/english|इंग्रजी|अंग्रेज़ी|अंग्रेजी/i.test(s)) return 'en';
  if (/marathi|मराठी/i.test(s)) return 'mr';
  if (/hindi|हिंदी|हिन्दी/i.test(s)) return 'hi';
  return null;
}

const NUMERIC_FIELD = /aadha?a?r|आधार|mobile|phone|मोबाईल|मोबाइल|pin|पिन|number|no|क्रमांक|नंबर|income|उत्पन्न|आय|area|क्षेत्र|age|वय|उम्र/i;
const NUM_WORDS = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  'शून्य': 0, 'एक': 1, 'दोन': 2, 'तीन': 3, 'चार': 4, 'पाच': 5, 'सहा': 6, 'सात': 7, 'आठ': 8, 'नऊ': 9,
  'दो': 2, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'नौ': 9,
};
const NUM_MULT = { double: 2, 'डबल': 2, triple: 3, 'ट्रिपल': 3 };
/** Spoken digits ("nine seven six") -> digit string; filler words are ignored. */
export function spokenDigits(text) {
  const tokens = String(text || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  let digits = '', numberTokens = 0, mult = 1;
  for (const tok of tokens) {
    if (/^[0-9०-९]+$/.test(tok)) { digits += toAsciiDigits(tok); numberTokens++; mult = 1; }
    else if (Object.hasOwn(NUM_WORDS, tok)) { digits += String(NUM_WORDS[tok]).repeat(mult); numberTokens++; mult = 1; }
    else if (Object.hasOwn(NUM_MULT, tok)) { mult = NUM_MULT[tok]; }
  }
  return { digits, numberTokens, totalTokens: tokens.length };
}

export function buildSttPrompt(lang, field) {
  const l = STT_EXAMPLES[lang] ? lang : 'en';
  const isName = /name|नाव|नाम/i.test(field || '');
  const parts = [];
  if (!isName && NUMERIC_FIELD.test(field || '')) {
    parts.push(`${field}: 4821 7730 9156`);
  } else if (isName) {
    parts.push(`${STT_LEAD[l]} ${STT_EXAMPLES[l]}.`);
  } else if (field) {
    parts.push(`${field}:`);
  }
  return parts.join(' ').slice(0, 400) || null;
}

/**
 * Voice post-processing by field (government form context).
 * - A transcript that is only digits and separators becomes plain digits:
 *   "9768-7312-1335" -> "976873121335" (Aadhaar, mobile, PIN, amounts).
 * - On a name field, a transcript that looks like a sentence is rejected, never offered:
 *   Whisper invents sentences from quiet or clipped audio ("so why are we…").
 */
const STT_FILLER = /\b(so|why|are|we|the|is|this|it|to|and|you|thank|thanks|sorry|bye|well|now|going|end|here|time|its|okay|yes|no|what|how)\b/i;
export function postProcessTranscript(text, field) {
  const t = String(text || '').trim();
  if (!t) return { text: '' };
  if (/^[\d\s,.\-–—०-९]+$/.test(t)) {
    const digits = toAsciiDigits(t).replace(/\D/g, '');
    if (digits) return { text: digits };
  }
  const isNameField = /name|नाव|नाम/i.test(String(field || ''));
  const sp = spokenDigits(t);
  if (sp.digits && ((!isNameField && NUMERIC_FIELD.test(String(field || ''))) ||
      (sp.numberTokens / sp.totalTokens >= 0.6 && sp.numberTokens >= 3))) {
    return { text: sp.digits };
  }
  if (isNameField) {
    const cleaned = t.replace(/[.!?।॥,;:]+$/u, '').trim();
    if (cleaned.split(/\s+/).length > 4 || STT_FILLER.test(cleaned)) return { text: '', rejected: 'not_a_name' };
    return { text: cleaned };
  }
  return { text: t };
}

web.post('/api/stt', async (req, res) => {
  const { audioBase64, lang, field } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required' });

  const buffer = Buffer.from(audioBase64.replace(/^data:[^,]+,/, ''), 'base64');

  // Voice is independent of documents (R9): only the field label steers Whisper.
  const whisperLang = fieldLanguage(field) || lang || null;
  const sttLang = ['en', 'hi', 'mr'].includes(whisperLang) ? whisperLang : 'en';
  const prompt = buildSttPrompt(sttLang, field);

  try {
    const { transcribe } = await import('./stt.js');
    const result = await transcribe(buffer, whisperLang, prompt);
    const post = postProcessTranscript(result.text, field);
    res.json({ ok: true, ...result, text: post.text, ...(post.rejected ? { rejected: post.rejected } : {}), language: whisperLang });
  } catch (err) {
    console.error('[web/stt]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** D9: image -> PDF. Conversion between image formats happens in the extension. */
web.post('/api/to-pdf', async (req, res) => {
  const { imageBase64, mime } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

  const { PDFDocument } = await import('pdf-lib');
  const bytes = Buffer.from(imageBase64.replace(/^data:[^,]+,/, ''), 'base64');

  try {
    const doc = await PDFDocument.create();
    const img = (mime || '').includes('png')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const pdf = Buffer.from(await doc.save());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Phase 14 (R1): upload slots name their document; this reads the label. */
const UPLOAD_WORDS = [
  ['identity', ['aadhaar', 'aadhar', 'adhaar', 'आधार', 'identity', 'ओळख', 'पहचान']],
  ['income', ['income', 'उत्पन्न', 'आय']],
  ['land', ['7/12', '७/१२', 'satbara', 'सातबारा', '8a', '८अ', 'land record', 'जमीन', 'भूमि']],
];
function docTypeFromLabel(label) {
  const s = String(label || '').toLowerCase();
  for (const [type, words] of UPLOAD_WORDS) if (words.some((w) => s.includes(w))) return type;
  return null;
}

/**
 * Phase 14 (R1): automated pre-submission check of ONE uploaded document. Called by the
 * extension when a file is picked in a portal upload slot. Reads it, judges it, reports.
 * Never blocks the upload.
 */
web.post('/api/check-upload', async (req, res) => {
  const { form, label, fileName, imageBase64, lang: l } = req.body || {};
  const lang = LANGUAGES.includes(l) ? l : 'en';
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
  const buffer = Buffer.from(String(imageBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const tr = (e) => ({ key: e.key, message: t(lang, e.key, e.params) });
  try {
    const { classifyDocument } = await import('./extractor.js');
    const docType = docTypeFromLabel(label) || await classifyDocument(buffer);
    if (!docType) {
      return res.json({ ok: false, docType: null, docName: null,
        errors: [tr({ key: 'upload_unknown_doc', params: {} })], notices: [], okMessage: null });
    }
    const doc = await extractDocument(buffer, docType);
    const r = validateDocument(docType, doc, { profile: {} });
    const errors = r.errors.map(tr);
    res.json({
      ok: errors.length === 0,
      docType,
      doc,
      docName: t(lang, `doc_${docType}`),
      errors,
      notices: r.notices.map(tr),
      okMessage: errors.length === 0 ? t(lang, 'upload_ok', { f: fileName || '' }) : null,
    });
  } catch (err) {
    console.error('[check-upload]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** resolveNames result -> { perDoc: {key: [message]}, notices: [message] } in one language. */
function nameMessages(r, lang) {
  const msg = (e) => {
    const p = e.params || {};
    if (e.key === 'form_name_suspect') return t(lang, e.key, { ...p, docs: p.docs.map((d) => t(lang, d)).join(', ') });
    if (e.key === 'name_conflict') return t(lang, e.key, { list: p.entries.map((x) => `${t(lang, x.d)}: ${x.a}`).join('; ') });
    return t(lang, e.key, { ...p, d: t(lang, p.d) });
  };
  const perDoc = {};
  for (const [k, list] of Object.entries(r.perDoc)) perDoc[k] = list.map(msg);
  return { perDoc, notices: r.notices.map(msg) };
}

/** Batch name check: all uploads against the NAME / land-holder boxes (find the odd one out). */
web.post('/api/check-names', (req, res) => {
  const { uploads, form, lang: l } = req.body || {};
  const lang = LANGUAGES.includes(l) ? l : 'en';
  if (!Array.isArray(uploads)) return res.status(400).json({ error: 'uploads is required' });
  res.json(nameMessages(resolveNames(uploads, form || {}), lang));
});

/** Free: is each local service up? */
web.get('/api/status', async (_req, res) => {
  const up = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  const [ai, voice] = await Promise.all([
    up(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/tags`),
    up(`${process.env.STT_URL || 'http://localhost:5005'}/health`),
  ]);
  res.json({ server: true, ai, aiModel: VLM_MODEL, voice });
});

web.get('/api/my-usage', (req, res) => res.json(myUsage(req.csc.key)));

/** Which inputs on a curated form hold the applicant name / land holder name. */
web.get('/api/form-fields', (req, res) => {
  const curated = findCurated(String(req.query.url || ''));
  res.json({
    nameFields: curated?.nameFields || [],
    landHolderFields: curated?.landHolderFields || [],
    mrLookup: curated?.mrLookup || {},
    lists: curated ? staticLists(curated) : {},
  });
});

// Demo portal: serves the taluka / village lists the way the real portal does ([{Value, Text}]).
// strLang is accepted and ignored (demo data is Marathi only).
let demoLists = null;
function demoList(kind, code) {
  if (!demoLists) demoLists = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'forms', 'demo-portal-lists.json'), 'utf8'));
  const table = demoLists[kind] || {};
  const rows = Object.hasOwn(table, String(code)) ? table[String(code)] : [];
  return rows.map(([Value, Text]) => ({ Value, Text }));
}
web.get('/en/StateGovEWS/District_SelectedState', (req, res) => res.json(demoList('talukas', req.query.Sel_DistrictName)));
web.get('/en/StateGovEWS/Taluka_SelectedState', (req, res) => res.json(demoList('villages', req.query.Sel_TalukaName)));
