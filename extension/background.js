// D13: all network calls go through this service worker.
const BASE = 'http://localhost:3000';

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }); } catch { /* no content script on this page */ }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'API') return false;
  const { method, path, body, binary } = msg;

  (async () => {
    try {
      const res = await fetch(BASE + path, {
        method: method || 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
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
