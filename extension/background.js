// D13: all network calls go through this service worker. Phase 14: one command per feature
// (R7); PDF work is relayed to an offscreen document running pdf.js (R3).
const DEFAULT_URL = 'http://localhost:3000';
const settings = () => chrome.storage.local.get({ serverUrl: DEFAULT_URL, apiKey: '' });

const FEATURE = { 'open-panel': 'PANEL' };

async function sendFeature(feature) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'FEATURE', feature }); } catch { /* no content script on this page */ }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const feature = FEATURE[command];
  if (feature) await sendFeature(feature);
});

chrome.action.onClicked.addListener(() => sendFeature('PANEL'));

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Read and render PDF files with pdf.js for format conversion, compression and upload checks.',
  });
}

// Dev auto-reload: reload the extension when the server reports changed extension files.
let extVersion = null;
async function checkExtVersion() {
  try {
    const { serverUrl } = await settings();
    const res = await fetch(String(serverUrl || DEFAULT_URL).replace(/\/+$/, '') + '/dev/ext-version');
    const { v } = await res.json();
    if (v == null) return;
    if (extVersion === null) extVersion = v;
    else if (v !== extVersion) chrome.runtime.reload();
  } catch { /* server down: silent */ }
}
checkExtVersion();
setInterval(checkExtVersion, 2000);

// After a reload, put the new window into pages that are already open.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'update') return;
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null || !/^https?:/i.test(tab.url || '')) continue;
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pick.js', 'content.js'] }); } catch { /* injection not allowed here */ }
    }
  } catch { /* ignore */ }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'EXT_VERSION_CHANGED') { chrome.runtime.reload(); return false; }

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
