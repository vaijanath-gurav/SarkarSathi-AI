// D13: all network calls go through this service worker. Phase 14: one command per feature
// (R7); PDF work is relayed to an offscreen document running pdf.js (R3).
const DEFAULT_URL = 'http://localhost:3000';
const settings = () => chrome.storage.local.get({ serverUrl: DEFAULT_URL, apiKey: '' });

const FEATURE = {
  'fill-form': 'FILL',
  'voice-chat': 'VOICE',
  'change-format': 'FORMAT',
  'compress': 'COMPRESS',
  'pick-client': 'CLIENT',
};

chrome.commands.onCommand.addListener(async (command) => {
  const feature = FEATURE[command];
  if (!feature) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'FEATURE', feature }); } catch { /* no content script on this page */ }
  }
});

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Read and render PDF files with pdf.js for format conversion, compression and upload checks.',
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'PDF') {
    (async () => {
      try {
        await ensureOffscreen();
        const r = await chrome.runtime.sendMessage({ type: 'PDF_OFFSCREEN', op: msg.op, args: msg.args });
        sendResponse(r || { ok: false, error: 'no response from PDF worker' });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }

  if (msg.type !== 'API') return false;
  const { method, path, body, binary } = msg;
  (async () => {
    try {
      const { serverUrl, apiKey } = await settings();
      const headers = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (apiKey) headers['X-Api-Key'] = apiKey;
      const res = await fetch(String(serverUrl || DEFAULT_URL).replace(/\/+$/, '') + path, {
        method: method || 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (binary && res.status === 401) { sendResponse(await res.json()); return; }
      if (binary) {
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        sendResponse({ ok: res.ok, base64: btoa(s) });
        return;
      }
      sendResponse(await res.json());
    } catch {
      sendResponse({ ok: false, error: 'service not running' });
    }
  })();
  return true;
});
