// DEV 3 OWNS THIS FILE.

const TOKEN = () => process.env.WHATSAPP_TOKEN;
const PHONE_ID = () => process.env.PHONE_NUMBER_ID;
const API = 'https://graph.facebook.com/v21.0';

/**
 * DRY_RUN captures outbound messages instead of sending them, so the whole conversation
 * can be exercised with no Meta account, no ngrok and no network. See src/simulate.js.
 * This is also the insurance policy behind ADR-5's hour-12 fallback: Layers 1-3 are
 * provably working even if the WhatsApp transport never lands.
 */
const isDryRun = () => process.env.DRY_RUN === 'true';
const outbox = [];

export function getOutbox() { return outbox; }
export function clearOutbox() { outbox.length = 0; }

async function post(body) {
  if (isDryRun()) {
    outbox.push(body);
    return { ok: true, dryRun: true };
  }
  const res = await fetch(`${API}/${PHONE_ID()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  if (!res.ok) console.error('[wa] send failed:', res.status, await res.text());
  return res;
}

export function sendText(to, text) {
  return post({ to, type: 'text', text: { body: text } });
}

export function sendLanguagePicker(to) {
  return post({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      // Three is the WhatsApp maximum for reply buttons — a fourth language would need
      // an interactive list instead.
      body: { text: 'Choose your language / भाषा चुनें / भाषा निवडा' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'lang_en', title: 'English' } },
          { type: 'reply', reply: { id: 'lang_hi', title: 'हिंदी' } },
          { type: 'reply', reply: { id: 'lang_mr', title: 'मराठी' } },
        ],
      },
    },
  });
}

/**
 * CRITICAL: media URLs expire 5 minutes after the webhook fires.
 * Call this the instant the webhook arrives, before any AI work.
 */
export async function downloadMedia(mediaId) {
  if (isDryRun()) return Buffer.from(`fake-media:${mediaId}`);

  const metaRes = await fetch(`${API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${TOKEN()}` },
  });
  if (!metaRes.ok) throw new Error(`media meta ${metaRes.status}`);
  const { url } = await metaRes.json();

  const binRes = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN()}` } });
  if (!binRes.ok) throw new Error(`media download ${binRes.status}`);
  return Buffer.from(await binRes.arrayBuffer());
}

/** Two-step: upload the PDF, then send it by id. */
export async function sendDocument(to, pdfBuffer, filename = 'EWS_Application.pdf') {
  if (isDryRun()) {
    outbox.push({ to, type: 'document', document: { filename, bytes: pdfBuffer.length } });
    return { ok: true, dryRun: true };
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);

  const up = await fetch(`${API}/${PHONE_ID()}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN()}` },
    body: form,
  });
  if (!up.ok) {
    console.error('[wa] upload failed:', up.status, await up.text());
    return;
  }
  const { id } = await up.json();
  return post({ to, type: 'document', document: { id, filename } });
}
