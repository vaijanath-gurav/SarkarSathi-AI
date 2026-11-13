// DEV 2 OWNS THIS FILE.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';

import { extractDocument } from './extractor.js';
import { validateEWS } from './rulebook.js';
import { generateEWSForm } from './pdf.js';
import { t } from './i18n/index.js';
import { getSession, resetSession, alreadyProcessed, STAGES } from './session.js';
import { buildReviewSummary, applyReviewReply } from './review.js';
import { transcribe, voiceToReviewReply, sttHealthy } from './stt.js';
import { web } from './web.js';
import { sendText, sendDocument, sendLanguagePicker, downloadMedia } from './whatsapp.js';

const app = express();
// Document photos arrive base64-encoded from the web surface; the default 100kb limit
// rejects any real phone photo.
app.use(express.json({ limit: '25mb' }));
app.use(web);
// The web router only maps '/' to index.html. Everything else under public/ — the mock
// portal, and anything added later — needs static serving. Mounted AFTER the router so
// the explicit '/' route still wins.
app.use(express.static('public'));

app.get('/health', (_req, res) => res.json({ ok: true, mock: process.env.USE_MOCK !== 'false' }));

// --- Meta webhook verification handshake ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

// --- Inbound messages ---
app.post('/webhook', (req, res) => {
  // ACK FIRST. Inference takes 10-40s; holding this open makes Meta retry
  // and you process the same photo three times. Do not move this line.
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;
    if (alreadyProcessed(message.id)) return;
    handleMessage(message).catch((err) => console.error('[handler]', err));
  } catch (err) {
    console.error('[webhook]', err);
  }
});

const DOC_STAGE = {
  [STAGES.IDENTITY]: 'identity',
  [STAGES.INCOME]: 'income',
  [STAGES.LAND]: 'land',
};

const NEXT_PROMPT = {
  [STAGES.IDENTITY]: 'ask_identity',
  [STAGES.INCOME]: 'ask_income',
  [STAGES.LAND]: 'ask_land',
  [STAGES.PURPOSE]: 'ask_purpose',
};

export async function handleMessage(message) {
  const from = message.from;
  const s = getSession(from);

  // --- language selection ---
  if (message.type === 'interactive') {
    const id = message.interactive?.button_reply?.id;
    if (id?.startsWith('lang_')) {
      s.language = id.replace('lang_', '');
      s.stage = STAGES.IDENTITY;
      await sendText(from, t(s.language, 'welcome'));
      await sendText(from, t(s.language, 'ask_identity'));
      return;
    }
  }

  if (message.type === 'text') {
    await handleTextInput(from, s, message.text.body);
    return;
  }

  // --- B10: voice notes. Transcribed locally, then handled exactly like text. ---
  if (message.type === 'audio' || message.type === 'voice') {
    const mediaId = message.audio?.id || message.voice?.id;

    let buffer;
    try {
      buffer = await downloadMedia(mediaId);   // 5-minute expiry applies here too
    } catch (err) {
      console.error('[media/audio]', err);
      await sendText(from, t(s.language, 'voice_failed'));
      return;
    }

    await sendText(from, t(s.language, 'listening'));

    let result;
    try {
      result = await transcribe(buffer, s.language);
    } catch (err) {
      console.error('[stt]', err);
      await sendText(from, t(s.language, 'voice_failed'));
      return;
    }

    if (!result.text) {
      await sendText(from, t(s.language, 'voice_empty'));
      return;
    }

    // No language switching on detection: we force the session language on the way in,
    // so whatever comes back merely echoes it. Auto-detect proved unusable on short
    // Indic clips (a Marathi note was identified as Tagalog). The language button is
    // the single source of truth.

    // Spoken phrasing -> the numeric protocol the review stage already speaks.
    const asText = s.stage === STAGES.REVIEW
      ? voiceToReviewReply(result.text)
      : result.text;

    await sendText(from, t(s.language, 'heard', { text: result.text }));
    await handleTextInput(from, s, asText);
    return;
  }

  // --- documents ---
  if (message.type === 'image' || message.type === 'document') {
    const docType = DOC_STAGE[s.stage];
    if (!docType) {
      await sendText(from, t(s.language, NEXT_PROMPT[s.stage] || 'restart'));
      return;
    }

    // Download IMMEDIATELY: media URLs expire 5 minutes after the webhook.
    const mediaId = message.image?.id || message.document?.id;
    let buffer;
    try {
      buffer = await downloadMedia(mediaId);
    } catch (err) {
      console.error('[media]', err);
      await sendText(from, t(s.language, 'extract_failed'));
      return;
    }

    // Async processing means silence. Tell the user something is happening.
    await sendText(from, t(s.language, 'processing'));

    let extracted;
    try {
      extracted = await extractDocument(buffer, docType);
    } catch (err) {
      console.error('[extract]', err);
      await sendText(from, t(s.language, 'extract_failed'));
      return;
    }

    if (extracted.image_quality_flag === true) {
      await sendText(from, t(s.language, 'blurry_retry'));
      return;
    }

    s.profile[docType] = extracted;
    const shownName = extracted.full_name || extracted.applicant_name || extracted.village_name;
    await sendText(from, t(s.language, 'read_ok', { name: shownName }));

    if (s.stage === STAGES.IDENTITY) {
      s.stage = STAGES.INCOME;
      await sendText(from, t(s.language, 'ask_income'));
    } else if (s.stage === STAGES.INCOME) {
      s.stage = STAGES.LAND;
      await sendText(from, t(s.language, 'ask_land'));
    } else if (s.stage === STAGES.LAND) {
      await runValidation(from, s);
    }
  }
}

/**
 * One path for typed text and transcribed speech, so voice can never drift out of
 * sync with chat. B10 relies on this.
 */
async function handleTextInput(from, s, rawText) {
  const text = String(rawText || '').trim();
  const body = text.toLowerCase();

  if (['hi', 'hello', 'start', 'namaste'].includes(body)) {
    resetSession(from);
    await sendLanguagePicker(from);
    return;
  }

  if (s.stage === STAGES.PURPOSE) {
    s.profile.purpose = text;
    await runValidation(from, s);
    return;
  }

  // B9 — review & correct. Every field is confirmed by the user before any PDF exists.
  if (s.stage === STAGES.REVIEW) {
    const r = applyReviewReply(s.profile, text);

    if (r.action === 'confirm') {
      await deliverForm(from, s);
    } else if (r.action === 'corrected') {
      await sendText(from, t(s.language, 'review_updated', {
        label: t(s.language, r.field.label), value: r.value,
      }));
      await sendText(from, buildReviewSummary(s.profile, s.language));
    } else {
      await sendText(from, t(s.language, 'review_unparsed'));
    }
    return;
  }

  await sendText(from, t(s.language, NEXT_PROMPT[s.stage] || 'restart'));
}

/** Layer 2 + Layer 3: validate, report problems, or produce the form. */
async function runValidation(from, s) {
  const result = validateEWS(s.profile);

  if (result.errors.length) {
    for (const e of result.errors) {
      await sendText(from, t(s.language, e.key, e.params));
    }
    return; // stop before generating anything: pre-submission validation
  }

  if (result.missing.includes('purpose')) {
    s.stage = STAGES.PURPOSE;
    await sendText(from, t(s.language, 'ask_purpose'));
    return;
  }

  if (result.missing.length) {
    const stageFor = { identity: STAGES.IDENTITY, income: STAGES.INCOME, land: STAGES.LAND };
    s.stage = stageFor[result.missing[0]];
    await sendText(from, t(s.language, NEXT_PROMPT[s.stage]));
    return;
  }

  // Validation passed — but nothing is generated until the user has checked every field.
  await sendText(from, t(s.language, 'all_clear'));
  s.stage = STAGES.REVIEW;
  await sendText(from, buildReviewSummary(s.profile, s.language));
}

/** Only reached after the user explicitly confirms the reviewed data. */
async function deliverForm(from, s) {
  const pdf = await generateEWSForm(s.profile);
  await sendDocument(from, pdf);
  await sendText(from, t(s.language, 'form_ready'));
  s.stage = STAGES.DONE;
}

// --- Local harness: run the whole flow with no WhatsApp and no AI ---
// curl -X POST localhost:3000/dev/run
app.post('/dev/run', async (_req, res) => {
  const load = async (f) => JSON.parse(await fs.readFile(`fixtures/${f}.json`, 'utf8'));
  const profile = {
    identity: await load('identity'),
    income: await load('income'),
    land: await load('land'),
    purpose: 'School admission',
  };
  const result = validateEWS(profile);
  if (!result.ok) return res.json({ result });
  const pdf = await generateEWSForm(profile);
  await fs.mkdir('out', { recursive: true });
  await fs.writeFile('out/EWS_Application.pdf', pdf);
  res.json({ result, pdf: 'out/EWS_Application.pdf' });
});

const PORT = process.env.PORT || 3000;

// Only listen when run directly. Importing this module (e.g. from src/simulate.js)
// must not bind a port.
if (process.env.NO_LISTEN !== 'true') {
app.listen(PORT, () => {
  const mock = process.env.USE_MOCK !== 'false';
  console.log(`\n  Server on http://localhost:${PORT}`);
  console.log(`  Extraction: ${mock ? 'MOCK (fixtures)' : `REAL (${process.env.VLM_MODEL})`}`);
  console.log(`  Try: curl -X POST http://localhost:${PORT}/dev/run\n`);

  // D4: extract anything new in MASTER/ so client selection is instant later.
  import('./clients.js')
    .then(async (m) => { await m.warmAll(); m.watchMaster(); })
    .catch((e) => console.error('[warm]', e.message));
});
}
