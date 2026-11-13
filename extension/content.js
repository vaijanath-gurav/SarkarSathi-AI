// Form assistant panel. Never submits anything (D11). All fetches go via background.js (D13).
(() => {
  if (window.__govtechPanel) return;
  window.__govtechPanel = true;

  let LANG = 'en';
  let STR = {};
  const api = (method, path, body, binary) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'API', method, path, body, binary }, (r) => {
        resolve(r || { ok: false, error: 'service not running' });
      });
    });

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .p{font:13px sans-serif;width:320px;background:#fff;color:#111;border:1px solid #888;border-radius:6px;padding:10px;box-shadow:0 2px 10px rgba(0,0,0,.3);max-height:90vh;overflow:auto}
      button,select,input,textarea{font:13px sans-serif;margin:3px 0;box-sizing:border-box}
      button{padding:5px 8px;cursor:pointer}
      select,textarea{width:100%}
      .row{display:flex;gap:6px;align-items:flex-start}
      .row textarea{flex:1}
      .err{color:#b00020}.okc{color:#0a7d2c}
      #status{margin-top:6px;font-weight:bold}
      .sec{border-top:1px solid #ddd;margin-top:6px;padding-top:6px}
      .hide{display:none}
    </style>
    <div class="p">
      <b id="s_title"></b>
      <select id="lang"><option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option></select>
      <div id="s_client"></div>
      <select id="client"></select>
      <div><button id="validate"></button></div>
      <div id="vresult"></div>
      <div><button id="fill"></button></div>
      <div><button id="voiceBtn"></button></div>
      <div id="voice" class="sec hide">
        <div class="row"><textarea id="vtext" rows="3"></textarea><button id="rec"></button></div>
        <button id="insert"></button>
      </div>
      <div><button id="convBtn"></button></div>
      <div id="conv" class="sec hide">
        <input type="file" id="cfile" accept="image/*">
        <div id="s_format"></div>
        <select id="cfmt"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WEBP</option><option value="pdf">PDF</option></select>
        <div><span id="s_maxsize"></span> <input type="number" id="cmax" value="200" style="width:70px"></div>
        <button id="cgo">Convert</button>
      </div>
      <div id="status"></div>
    </div>`;
  document.documentElement.appendChild(host);
  host.style.display = 'none';

  const $ = (id) => root.getElementById(id);
  const status = (msg, cls) => { const s = $('status'); s.textContent = msg; s.className = cls || ''; };

  const T = (k) => STR[k] || '';
  function applyStrings() {
    $('s_title').textContent = T('panel_title');
    $('s_client').textContent = T('panel_client');
    $('validate').textContent = T('panel_validate');
    $('fill').textContent = T('panel_fill');
    $('voiceBtn').textContent = T('panel_voice');
    $('convBtn').textContent = T('panel_convert');
    $('rec').textContent = T('panel_record');
    $('insert').textContent = T('panel_insert');
    $('s_format').textContent = T('panel_format');
    $('s_maxsize').textContent = T('panel_maxsize');
  }
  async function loadStrings() {
    const r = await api('GET', `/api/strings?lang=${LANG}`);
    if (r && r.panel_title) STR = r;
    applyStrings();
  }
  async function setLang(l) {
    LANG = l;
    $('lang').value = l;
    await loadStrings();
    await loadClients();
  }
  $('lang').onchange = () => {
    chrome.storage.local.set({ lang: $('lang').value });
    setLang($('lang').value);
  };

  let lastFocused = null;
  document.addEventListener('focusin', (e) => {
    if (e.target !== host && e.target.matches && e.target.matches('input,textarea,select')) lastFocused = e.target;
  });

  async function loadClients() {
    const r = await api('GET', '/api/clients');
    const sel = $('client');
    sel.innerHTML = '';
    if (!Array.isArray(r)) { status(T('panel_no_service'), 'err'); return; }
    for (const c of r) {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + (c.ready ? '' : ' ' + T('panel_incomplete'));
      o.disabled = !c.ready;
      sel.appendChild(o);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'TOGGLE_PANEL') {
      const show = host.style.display === 'none';
      host.style.display = show ? 'block' : 'none';
      if (show) chrome.storage.local.get('lang', (v) => setLang(v.lang || 'en'));
    }
  });

  $('validate').onclick = async () => {
    const key = $('client').value;
    if (!key) return status(T('panel_no_client'), 'err');
    const r = await api('GET', `/api/clients/${encodeURIComponent(key)}/validate?lang=${LANG}`);
    const out = $('vresult');
    out.innerHTML = '';
    if (r.error) return status(r.error, 'err');
    if (r.ok) {
      const d = document.createElement('div'); d.className = 'okc'; d.textContent = T('all_clear'); out.appendChild(d);
    } else {
      for (const e of r.errors || []) {
        const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message; out.appendChild(d);
      }
    }
    status('');
  };

  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent.trim();
    }
    const anc = el.closest('label');
    if (anc) return anc.textContent.trim();
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    let n = el.previousSibling;
    while (n) {
      if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim();
      n = n.previousSibling;
    }
    return '';
  }

  $('fill').onclick = async () => {
    const key = $('client').value;
    if (!key) return status(T('panel_no_client'), 'err');
    const els = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')];
    const refs = new Map();
    const fields = els.map((el, i) => {
      const ref = `f${i}`;
      refs.set(ref, el);
      return { ref, label: labelFor(el), name: el.name || '', id: el.id || '', placeholder: el.placeholder || '', type: el.type || '' };
    });
    const r = await api('POST', '/api/fill', { client: key, url: location.href, fields });
    if (r.error || !r.values) return status(r.error || T('panel_fill_failed'), 'err');
    for (const [ref, value] of Object.entries(r.values)) {
      const el = refs.get(ref);
      if (!el) continue;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.outline = '2px solid #0a7d2c';
    }
    status(T('panel_filled').replace('{n}', r.matched).replace('{total}', r.total), 'okc');
  };

  $('voiceBtn').onclick = () => { $('voice').classList.toggle('hide'); };

  let recorder = null, chunks = [];
  $('rec').onclick = async () => {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        $('rec').textContent = T('panel_record');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        const r = await api('POST', '/api/stt', { audioBase64: dataUrl, lang: LANG });
        if (r.ok && r.text) { $('vtext').value = r.text; status(''); }
        else status(T('voice_empty'), 'err');
      };
      recorder.start();
      $('rec').textContent = T('panel_stop');
    } catch (e) {
      status(T('voice_failed'), 'err');
    }
  };

  $('insert').onclick = () => {
    if (!lastFocused) return status(T('panel_click_field'), 'err');
    lastFocused.value = $('vtext').value;
    lastFocused.dispatchEvent(new Event('input', { bubbles: true }));
    lastFocused.dispatchEvent(new Event('change', { bubbles: true }));
    status(T('panel_inserted'), 'okc');
  };

  $('convBtn').onclick = () => { $('conv').classList.toggle('hide'); };

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  $('cgo').onclick = async () => {
    const file = $('cfile').files[0];
    if (!file) return status(T('panel_choose_image'), 'err');
    const fmt = $('cfmt').value;
    const budget = (parseInt($('cmax').value, 10) || 200) * 1024;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
    const base = file.name.replace(/\.[^.]+$/, '');
    const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

    const targetType = fmt === 'pdf' ? 'image/jpeg' : fmt;
    let scale = 1, blob = null;
    for (let round = 0; round < 4; round++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (let q = 0.92; ; q -= 0.07) {
        const qq = Math.max(q, 0.3);
        blob = await toBlob(c, targetType, qq);
        if (blob.size <= budget || qq <= 0.3) break;
      }
      if (blob.size <= budget) break;
      scale /= 2;
    }

    if (fmt === 'pdf') {
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      const r = await api('POST', '/api/to-pdf', { imageBase64: dataUrl, mime: 'image/jpeg' }, true);
      if (!r.ok || !r.base64) return status(T('panel_pdf_failed'), 'err');
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pdf = new Blob([bytes], { type: 'application/pdf' });
      download(pdf, `${base}.pdf`);
      status(T('panel_done_kb').replace('{n}', Math.round(pdf.size / 1024)), 'okc');
    } else {
      const ext = fmt.split('/')[1].replace('jpeg', 'jpg');
      download(blob, `${base}.${ext}`);
      status(T('panel_done_kb').replace('{n}', Math.round(blob.size / 1024)), 'okc');
    }
  };
})();
