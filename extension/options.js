const DEFAULT_URL = 'http://localhost:3000';
const $ = (id) => document.getElementById(id);
const clean = () => ({
  serverUrl: ($('serverUrl').value.trim() || DEFAULT_URL).replace(/\/+$/, ''),
  apiKey: $('apiKey').value.trim(),
});
const show = (text, cls) => { $('msg').textContent = text; $('msg').className = cls || ''; };

chrome.storage.local.get({ serverUrl: DEFAULT_URL, apiKey: '' }, (v) => {
  $('serverUrl').value = v.serverUrl;
  $('apiKey').value = v.apiKey;
});
$('toggle').onchange = () => { $('apiKey').type = $('toggle').checked ? 'text' : 'password'; };
$('save').onclick = () => {
  const v = clean();
  $('serverUrl').value = v.serverUrl;
  chrome.storage.local.set(v, () => show('Saved', 'ok'));
};
$('test').onclick = async () => {
  const { serverUrl, apiKey } = clean();
  try {
    const res = await fetch(serverUrl + '/api/whoami', { headers: apiKey ? { 'X-Api-Key': apiKey } : {} });
    if (res.status === 401) return show('Key not accepted', 'bad');
    const j = await res.json();
    if (res.ok && j.ok) show('Connected as ' + j.name, 'ok');
    else show('Server not reachable', 'bad');
  } catch { show('Server not reachable', 'bad'); }
};
