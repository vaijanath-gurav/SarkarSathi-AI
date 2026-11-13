// DEV 3 OWNS THIS FILE.

const TOKEN = () => process.env.WHATSAPP_TOKEN;
const PHONE_ID = () => process.env.PHONE_NUMBER_ID;
const API = 'https://graph.facebook.com/v21.0';

async function post(body) {
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
      body: { text: 'Choose your language / भाषा निवडा' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'lang_en', title: 'English' } },
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
