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
import { validateEWS } from './rulebook.js';
import { generateEWSForm } from './pdf.js';
import { t } from './i18n/index.js';
import { REVIEW_FIELDS } from './review.js';
import { listClients, getProfile, warmAll } from './clients.js';
import { LANGUAGES } from './i18n/index.js';
import { matchFields } from './fieldmap.js';

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
  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
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
  const values = matchFields({ profile, url, fields });
  res.json({ values, matched: Object.keys(values).length, total: fields.length });
});

/** Proxy to the local STT service so the extension needs only one origin. */
web.post('/api/stt', async (req, res) => {
  const { audioBase64, lang } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required' });

  const buffer = Buffer.from(audioBase64.replace(/^data:[^,]+,/, ''), 'base64');
  try {
    const { transcribe } = await import('./stt.js');
    const result = await transcribe(buffer, lang || null);
    res.json({ ok: true, ...result });
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
