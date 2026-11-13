// ADR-5 fallback surface: the same pipeline, reached over HTTP instead of WhatsApp.
//
// Layers 1-3 are channel-agnostic by design, so this file is pure transport. It adds
// no validation, no business rules and no prompts of its own - it calls exactly the
// same extractor, rulebook and PDF generator the WhatsApp path uses.
//
// If the WhatsApp transport lands later, nothing here needs to change or be removed.

import express from 'express';
import path from 'node:path';

import { extractDocument } from './extractor.js';
import { validateEWS, validateDocument, toAsciiDigits } from './rulebook.js';
import { generateEWSForm } from './pdf.js';
import { t } from './i18n/index.js';
import { REVIEW_FIELDS } from './review.js';
import { listClients, getProfile, warmAll, setOverride } from './clients.js';
import { LANGUAGES } from './i18n/index.js';
import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs, findCurated } from './fieldmap.js';

export const web = express.Router();

// D14: the extension's service worker calls these routes from a different origin.
// The service binds localhost only, so a permissive header is appropriate here.
web.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
    'pop_not_a_name',
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
  const { client, label, fileName, imageBase64, lang: l } = req.body || {};
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
    const profile = client ? await getProfile(client) : {};
    const r = validateDocument(docType, doc, { profile });
    res.json({
      ok: r.ok,
      docType,
      docName: t(lang, `doc_${docType}`),
      errors: r.errors.map(tr),
      notices: r.notices.map(tr),
      okMessage: r.ok ? t(lang, 'upload_ok', { f: fileName || '' }) : null,
    });
  } catch (err) {
    console.error('[check-upload]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
