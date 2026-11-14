// Form assistant. One keybind per feature, each in a small pop-up from the bottom (R7). Never submits anything (D11). All fetches go via background.js (D13).
(() => {
  if (window.__govtechPanel) return;
  window.__govtechPanel = true;

  const uploads = {};
  let formFields = null;
  let nameListenerOn = false;
  let LANG = 'en';
  let STR = {};
  const api = (method, path, body, binary) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'API', method, path, body, binary }, (r) => {
        resolve(r || { ok: false, error: 'service not running' });
      });
    });

  const pdf = (op, args) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'PDF', op, args }, (r) => resolve(r || { ok: false, error: 'no response' }));
  });
  const readDataUrl = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  const dataUrlToBlob = (u) => { const [h, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.slice(5).split(';')[0] }); };
  const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const baseName = (f) => f.name.replace(/\.[^.]+$/, '');

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .pop{display:none;pointer-events:auto;position:absolute;left:50%;bottom:24px;width:min(560px, calc(100vw - 32px));max-height:60vh;overflow:auto;box-sizing:border-box;background:#fff;color:#111;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.28);padding:14px 16px;font:14px system-ui,'Nirmala UI',sans-serif;transform:translate(-50%,120%);opacity:0;transition:transform 180ms ease,opacity 180ms ease}
      .pop.vis{display:block}
      .pop.in{transform:translate(-50%,0);opacity:1}
      button,select,input,textarea{font:14px system-ui,'Nirmala UI',sans-serif;margin:3px 0;box-sizing:border-box}
      button{padding:5px 10px;cursor:pointer}
      textarea{width:100%}
      .head{display:flex;gap:8px;align-items:center}
      .head b{flex:1}
      .row{margin:6px 0}
      .err{color:#b00020}.okc{color:#0a7d2c}.warn{color:#a15c00}
      #status{margin-top:6px;font-weight:bold}
      #body div{margin:3px 0}
    </style>
    <div class="pop" id="pop">
      <div class="head">
        <b id="title"></b>
        <select id="lang"><option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option></select>
        <select id="client"></select>
        <button id="close">✕</button>
      </div>
      <div id="body"></div>
      <div id="status"></div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const pop = $('pop');
  const body = $('body');
  const status = (msg, cls) => { const s = $('status'); s.textContent = msg; s.className = cls || ''; };
  const T = (k) => STR[k] || '';
  // A rejected API key gets its own message instead of the generic failure text.
  const keyBad = (r) => !!r && (r.error === 'api_key_missing' || r.error === 'api_key_invalid');
  const apiErr = (r, fallback) => (keyBad(r) ? T('pop_api_key') : fallback);

  // ---- pop-up shell -------------------------------------------------------
  let isOpen = false;
  let currentFeature = null;
  let currentTitleKey = null;
  let popSeq = 0;
  let closeTimer = null;
  let recorder = null;
  let recCancelled = false;

  function applyLabels() {
    for (const el of root.querySelectorAll('[data-k]')) el.textContent = T(el.dataset.k);
    if (currentTitleKey) $('title').textContent = T(currentTitleKey);
  }
  const label = (el, key) => { el.dataset.k = key; el.textContent = T(key); return el; };
  const line = (text, cls, bold) => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (bold) d.style.fontWeight = 'bold';
    d.textContent = text;
    body.appendChild(d);
    return d;
  };

  function closePopup() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(closeTimer);
    if (recorder && recorder.state === 'recording') { recCancelled = true; recorder.stop(); }
    pop.classList.remove('in');
    setTimeout(() => { if (!isOpen) pop.classList.remove('vis'); }, 180);
  }
  function openPopup(feature, titleKey) {
    clearTimeout(closeTimer);
    if (recorder && recorder.state === 'recording') { recCancelled = true; recorder.stop(); }
    popSeq++;
    currentFeature = feature;
    currentTitleKey = titleKey;
    $('title').textContent = T(titleKey);
    body.innerHTML = '';
    status('');
    pop.classList.add('vis');
    void pop.offsetWidth;
    pop.classList.add('in');
    isOpen = true;
  }
  function autoClose(ms) {
    const seq = popSeq;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (popSeq === seq) closePopup(); }, ms);
  }
  $('close').onclick = closePopup;
  document.addEventListener('keydown', (e) => { if (isOpen && e.key === 'Escape') closePopup(); }, true);

  // ---- strings, language, clients ----------------------------------------
  async function loadStrings() {
    const r = await api('GET', `/api/strings?lang=${LANG}`);
    if (r && r.panel_title) STR = r;
    applyLabels();
  }
  let savedClient = '';
  async function loadClients() {
    const r = await api('GET', '/api/clients');
    const sel = $('client');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '—';
    sel.appendChild(none);
    if (!Array.isArray(r)) { status(keyBad(r) ? T('pop_api_key') : T('panel_no_service'), 'err'); return false; }
    for (const c of r) {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + (c.ready ? '' : ' ' + T('panel_incomplete'));
      // Phase 11: incomplete clients stay selectable; Validate still reports what is missing.
      sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === savedClient)) sel.value = savedClient;
    return true;
  }
  let ready = null;
  function ensureReady() {
    if (!ready) {
      ready = (async () => {
        const v = await new Promise((res) => chrome.storage.local.get(['lang', 'client'], res));
        LANG = v.lang || 'en';
        savedClient = v.client || '';
        $('lang').value = LANG;
        await loadStrings();
        const ok = await loadClients();
        if (!ok || !STR.panel_title) ready = null;
      })();
    }
    return ready;
  }
  $('lang').onchange = async () => {
    LANG = $('lang').value;
    chrome.storage.local.set({ lang: LANG });
    savedClient = $('client').value;
    await loadStrings();
    await loadClients();
    if (isOpen && currentFeature === 'FILL') runFill();
  };
  $('client').onchange = () => {
    savedClient = $('client').value;
    chrome.storage.local.set({ client: savedClient });
    if (!isOpen) return;
    if (currentFeature === 'FILL') runFill();
    else if (currentFeature === 'CLIENT') autoClose(800);
  };

  let lastFocused = null;
  document.addEventListener('focusin', (e) => {
    if (e.target !== host && e.target.matches && e.target.matches('input,textarea,select')) lastFocused = e.target;
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'FEATURE') return;
    if (msg.feature === 'FILL') runFill();
    else if (msg.feature === 'VOICE') runVoice();
    else if (msg.feature === 'FORMAT') runFormat();
    else if (msg.feature === 'COMPRESS') runCompress();
    else if (msg.feature === 'CLIENT') runClient();
  });

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

  // Resolve a select we hold a stored list for (mrLookup) to an option CODE. Never uses the page's
  // visible text (it may be translated). state: 'found' | 'none' | 'fallback' (no stored code is
  // on this page at all, so the caller may use visible text).
  async function storedList(el, lookup, lists) {
    if (lookup.static) {
      const m = lists[lookup.static];
      return m ? Object.entries(m).map(([value, text]) => ({ value, text })) : null;
    }
    if (lookup.url) {
      const parent = document.getElementById(lookup.parent);
      if (!parent || !parent.value) return null;
      try {
        const res = await fetch(location.origin + lookup.url + '?' +
          new URLSearchParams({ [lookup.param]: parent.value, strLang: '2' }), { credentials: 'same-origin' });
        const data = res.ok ? await res.json() : null;
        return Array.isArray(data) ? data.map((o) => ({ value: String(o.Value), text: String(o.Text) })) : null;
      } catch (_) { return null; }
    }
    return null;
  }
  async function resolveByCode(el, lookup, lists, spec) {
    const list = await storedList(el, lookup, lists);
    if (!list) return { state: 'none' };
    const have = new Set([...el.options].map((o) => o.value));
    if (list.length && !list.some((o) => have.has(o.value))) return { state: 'fallback' };
    const hit = window.__govtechPick.resolveCode(list, spec);
    if (hit && have.has(hit.code)) return { state: 'found', value: hit.code, fuzzy: hit.fuzzy };
    return { state: 'none' };
  }

  // ---- FILL ---------------------------------------------------------------
  async function runFill() {
    await ensureReady();
    openPopup('FILL', 'panel_fill');
    const seq = popSeq;
    const key = $('client').value;
    if (!key) return status(T('pop_choose_client'), 'warn');

    // Validation lines; re-rendered (old ones removed) when the operator types an override.
    let valLines = [];
    const renderValidation = async () => {
      const v = await api('GET', `/api/clients/${encodeURIComponent(key)}/validate?lang=${LANG}`);
      if (popSeq !== seq) return null;
      if (v.error) { status(apiErr(v, v.error), 'err'); return null; }
      for (const d of valLines) d.remove();
      valLines = [];
      let probs = false;
      const add = (...a) => { valLines.push(line(...a)); };
      if (v.ok) add(T('all_clear'), 'okc');
      else {
        for (const e of v.errors || []) { add(e.message, 'err'); probs = true; }
      }
      // Phase 12: an incomplete client used to show a blank box.
      if (v.missing_message) { add(v.missing_message, 'err'); probs = true; }
      // Phase 9: fields the operator types from paper. Amber, not red: not a failure.
      for (const n of v.notices || []) add(n.message, 'warn');
      return probs;
    };
    const problems = await renderValidation();
    if (problems === null) return;

    const els = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')];
    const refs = new Map();
    const fields = els.map((el, i) => {
      const ref = `f${i}`;
      refs.set(ref, el);
      return { ref, label: labelFor(el), name: el.name || '', id: el.id || '', placeholder: el.placeholder || '', type: el.type || '' };
    });
    const r = await api('POST', '/api/fill', { client: key, url: location.href, fields });
    if (r.error || !r.values) return status(apiErr(r, r.error || T('panel_fill_failed')), 'err');
    // A13 (R5): curated forms only.
    if (r.curated === false) return status(T('pop_not_curated'), 'warn');
    for (const [ref, value] of Object.entries(r.values)) {
      const el = refs.get(ref);
      // Phase 10: dropdowns are handled by chains below; never write read-only fields.
      if (!el || el.tagName === 'SELECT' || el.readOnly || el.disabled) continue;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.outline = '2px solid #0a7d2c';
    }
    // Phase 9: never filled from the model. Left empty, outlined amber, operator types it.
    for (const ref of r.operator || []) {
      const el = refs.get(ref);
      if (!el) continue;
      el.value = '';
      el.style.outline = '3px solid #e69500';
      el.title = T('panel_operator_field');
    }
    // Phase 10: a document figure shown as a placeholder, for the operator to check against.
    for (const [ref, v] of Object.entries(r.hints || {})) {
      const el = refs.get(ref);
      if (!el) continue;
      el.placeholder = T('panel_check_figure').replace('{n}', v);
    }
    // Phase 14 (ADR-8): filled, but possibly a machine transliteration — operator checks it.
    let toCheck = 0;
    for (const ref of r.verify || []) {
      const el = refs.get(ref);
      if (!el || !el.value) continue;
      el.style.outline = '3px dashed #e69500';
      el.title = T('panel_verify_field');
      toCheck++;
    }
    // Phase 10: dropdowns. Selects we hold a stored list for are resolved by CODE (page text may be
    // machine-translated); the rest by visible text. A later dropdown in a chain loads only
    // after the earlier one changes, so wait for its option VALUES to change (max 5 s).
    // If one link fails, the rest of that chain is left for the operator.
    const snap = (el) => [...el.options].map((o) => o.value).join('|');
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const lists = { ...(r.districtsMr ? { districtsMr: r.districtsMr } : {}), ...(r.lists || {}) };
    let picked = 0;
    for (const chain of r.chains || []) {
      let broken = false;
      for (let i = 0; i < chain.length; i++) {
        const el = document.getElementById(chain[i].id);
        if (!el || el.tagName !== 'SELECT') { broken = true; continue; }
        if (broken) { el.style.outline = '3px solid #e69500'; continue; }
        const spec = chain[i];
        let value = null;
        let fuzzy = false;
        const lookup = r.mrLookup && r.mrLookup[el.id];
        let byText = !lookup;
        if (lookup) {
          const res = await resolveByCode(el, lookup, lists, spec);
          if (res.state === 'fallback') byText = true;
          else if (res.state === 'found') { value = res.value; fuzzy = res.fuzzy; }
        }
        if (byText) {
          value = window.__govtechPick.pickOption(
            [...el.options].map((o) => ({ value: o.value, text: o.text })), spec);
          fuzzy = window.__govtechPick.pickOption.lastFuzzy;
        }
        if (value == null) {
          console.warn(`[govtech] no match for #${el.id}: source="${spec.source || (spec.candidates || []).join('/')}", first options=${JSON.stringify([...el.options].slice(0, 5).map((o) => o.text))}`);
        }
        if (value == null) { el.style.outline = '3px solid #e69500'; broken = true; continue; }
        el.style.outline = fuzzy ? '3px dashed #e69500' : '2px solid #0a7d2c';
        if (fuzzy) { el.title = T('panel_verify_field'); toCheck++; }
        picked++;
        if (el.value === value) continue;
        const next = chain[i + 1] && document.getElementById(chain[i + 1].id);
        const before = next && next.tagName === 'SELECT' ? snap(next) : null;
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (before !== null) {
          const t0 = Date.now();
          while (snap(next) === before && Date.now() - t0 < 5000) await sleep(200);
        }
      }
    }
    // Operator-typed values flow back into the client profile, then validation re-runs.
    const postOverride = async (p, v) => {
      await api('POST', `/api/clients/${encodeURIComponent(key)}/override`, { path: p, value: v });
      await renderValidation();
    };
    const ov = r.overrides || {};
    for (const [selector, p] of Object.entries(ov.fields || {})) {
      const el = document.querySelector(selector);
      if (el && !el.dataset.govtechOverride) {
        el.dataset.govtechOverride = '1';
        el.addEventListener('change', () => postOverride(p, el.value));
      }
    }
    if (ov.area) {
      const areaEl = document.querySelector(ov.area.area);
      const unitEl = document.querySelector(ov.area.unit);
      const factorFor = (text) => {
        const t = String(text || '').trim().toLowerCase();
        if (/acre|एकर/.test(t)) return 0.404686;
        if (/गुंठ|guntha/.test(t)) return 0.0101171;
        if (/हेक्टर|hectare/.test(t)) return 1;
        if (/square\s*m|चौ/.test(t)) return 0.0001;
        if (/yard/.test(t)) return 0.0000836127;
        if (t === 'आर' || /\bare\b/.test(t)) return 0.01;
        return null;
      };
      const postArea = () => {
        const n = parseFloat(String(areaEl.value).replace(',', '.'));
        const opt = unitEl.options && unitEl.options[unitEl.selectedIndex];
        const f = opt && unitEl.value ? factorFor(opt.text) : null;
        const ha = n > 0 && f ? (n * f).toFixed(4) : '';
        postOverride('land.total_area_hectares', ha);
      };
      for (const el of [areaEl, unitEl]) {
        if (el && !el.dataset.govtechOverride) {
          el.dataset.govtechOverride = '1';
          el.addEventListener('change', postArea);
        }
      }
    }
    if (popSeq !== seq) return;
    // Phase 12: say why, instead of "0 of 34".
    if (r.matched + picked === 0) status(T('panel_fill_nothing'), 'err');
    else {
      status(T('pop_summary').replace('{n}', r.matched + picked).replace('{o}', (r.operator || []).length).replace('{c}', toCheck), 'okc');
    }
    if (!problems) autoClose(6000);
  }

  // ---- VOICE (R2, D6, D7) -------------------------------------------------
  async function runVoice() {
    await ensureReady();
    openPopup('VOICE', 'panel_voice');
    let target = lastFocused && document.contains(lastFocused) ? lastFocused : null;
    if (!target) {
      const a = document.activeElement;
      if (a && a.matches && a.matches('input,textarea,select')) target = a;
    }
    if (!target) return status(T('panel_click_field'), 'err');

    line(labelFor(target), '', true);
    const ta = document.createElement('textarea');
    ta.rows = 3;
    body.appendChild(ta);
    const rec = document.createElement('button');
    label(rec, 'panel_record');
    const ins = document.createElement('button');
    label(ins, 'panel_insert');
    const brow = document.createElement('div');
    brow.append(rec, ' ', ins);
    body.appendChild(brow);

    const ffReady = loadFormFields().catch(() => { /* no service: selects fall back to visible text */ });
    const doInsert = async () => {
      const text = ta.value;
      await ffReady;
      if (target.tagName === 'SELECT') {
        const options = [...target.options].map((o) => ({ value: o.value, text: o.text }));
        const lookup = formFields && formFields.mrLookup && formFields.mrLookup[target.id];
        let value = null;
        let fuzzy = false;
        let byText = !lookup;
        if (lookup) {
          const gender = lookup.static === 'genderMr';
          const list = await storedList(target, lookup, formFields.lists || {});
          const have = new Set(options.map((o) => o.value));
          if (list && list.length && !list.some((o) => have.has(o.value))) byText = true;
          else if (list) {
            let hit = window.__govtechPick.resolveCode(list, { mode: 'oneOf', candidates: [text], gender });
            if (!hit && !gender) hit = window.__govtechPick.resolveCode(list, { mode: 'within', source: text });
            if (hit && have.has(hit.code)) { value = hit.code; fuzzy = hit.fuzzy; }
          }
        }
        if (byText) {
          value = window.__govtechPick.pickOption(options, { mode: 'oneOf', candidates: [text] });
          if (value == null) value = window.__govtechPick.pickOption(options, { mode: 'within', source: text });
        }
        if (value == null) return status(T('pop_no_option'), 'err');
        target.value = value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.style.outline = fuzzy ? '3px dashed #e69500' : '2px solid #0a7d2c';
      } else {
        target.value = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.style.outline = '2px solid #0a7d2c';
      }
      status(T('panel_inserted'), 'okc');
      autoClose(800);
    };
    ins.onclick = doInsert;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) doInsert(); });

    let chunks = [];
    const startRec = async () => {
      if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recCancelled = false;
        recorder = new MediaRecorder(stream);
        const mine = recorder;
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          if (recCancelled) return;
          rec.dataset.k = 'panel_record';
          rec.textContent = T('panel_record');
          const blob = new Blob(chunks, { type: mine.mimeType });
          const dataUrl = await readDataUrl(blob);
          const r = await api('POST', '/api/stt', { audioBase64: dataUrl, lang: LANG, client: $('client').value || '', field: labelFor(target) });
          if (r.ok && r.rejected === 'not_a_name') { ta.value = ''; ta.focus(); status(T('pop_not_a_name'), 'err'); }
          else if (r.ok && r.text) { ta.value = r.text; ta.focus(); status(''); }
          else status(apiErr(r, T('voice_empty')), 'err');
        };
        recorder.start();
        rec.dataset.k = 'panel_stop';
        rec.textContent = T('panel_stop');
        status(T('pop_listening'), 'warn');
      } catch (e) {
        status(T('voice_failed'), 'err');
      }
    };
    rec.onclick = startRec;
    startRec();
    ta.focus();
  }

  // ---- file helpers shared by FORMAT / COMPRESS ---------------------------
  const isText = (f) => f && (f.type === 'text/plain' || /\.txt$/i.test(f.name));
  const kindOf = (f) => (!f ? null : isPdf(f) ? 'pdf' : isText(f) ? 'text' : (f.type || '').startsWith('image/') ? 'image' : null);
  const loadImage = (file) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  function fileInput(accept, preload, onChange) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    if (preload) {
      try { const dt = new DataTransfer(); dt.items.add(preload); inp.files = dt.files; } catch { /* leave empty */ }
    }
    inp.addEventListener('change', onChange);
    const d = document.createElement('div');
    d.appendChild(inp);
    body.appendChild(d);
    return inp;
  }

  // ---- FORMAT (R3) --------------------------------------------------------
  async function runFormat(preload) {
    await ensureReady();
    openPopup('FORMAT', 'panel_format');
    const sel = document.createElement('select');
    const rebuild = () => {
      sel.innerHTML = '';
      const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
      const k = kindOf(inp.files[0]);
      if (k === 'image') { add('image/jpeg', 'JPEG'); add('image/png', 'PNG'); add('image/webp', 'WEBP'); add('pdf', 'PDF'); }
      else if (k === 'pdf') { add('txt', T('pop_to_text')); add('png-pages', 'PNG · ' + T('pop_to_pages')); add('jpeg-pages', 'JPEG · ' + T('pop_to_pages')); }
      else if (k === 'text') add('txt-pdf', 'PDF');
    };
    const inp = fileInput('image/*,application/pdf,text/plain,.txt', preload, rebuild);
    const sd = document.createElement('div');
    sd.appendChild(sel);
    body.appendChild(sd);
    const go = document.createElement('button');
    label(go, 'pop_convert');
    const gd = document.createElement('div');
    gd.appendChild(go);
    body.appendChild(gd);
    rebuild();

    go.onclick = async () => {
      const f = inp.files[0];
      if (!f) return status(T('panel_choose_image'), 'err');
      const fmt = sel.value;
      const base = baseName(f);
      let total = 0;
      const save = (blob, name) => { total += blob.size; download(blob, name); };
      try {
        if (kindOf(f) === 'image') {
          const img = await loadImage(f);
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          if (fmt === 'pdf') {
            const jpg = await toBlob(c, 'image/jpeg', 0.92);
            const r = await api('POST', '/api/to-pdf', { imageBase64: await readDataUrl(jpg), mime: 'image/jpeg' }, true);
            if (!r.ok || !r.base64) return status(apiErr(r, T('panel_pdf_failed')), 'err');
            save(dataUrlToBlob('data:application/pdf;base64,' + r.base64), `${base}.pdf`);
          } else {
            const blob = await toBlob(c, fmt, 0.92);
            save(blob, `${base}.${fmt.split('/')[1].replace('jpeg', 'jpg')}`);
          }
        } else if (kindOf(f) === 'pdf') {
          const b64 = await readDataUrl(f);
          if (fmt === 'txt') {
            const r = await pdf('text', { b64 });
            if (!r.ok) return status(T('panel_pdf_failed'), 'err');
            save(new Blob([r.text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
          } else {
            const type = fmt === 'png-pages' ? 'image/png' : 'image/jpeg';
            const r = await pdf('images', { b64, type });
            if (!r.ok || !r.pages) return status(T('panel_pdf_failed'), 'err');
            const ext = fmt === 'png-pages' ? 'png' : 'jpg';
            r.pages.forEach((p, i) => save(dataUrlToBlob(p), `${base}-p${i + 1}.${ext}`));
          }
        } else if (kindOf(f) === 'text') {
          const r = await pdf('textToPdf', { text: await f.text() });
          if (!r.ok || !r.pdf) return status(T('panel_pdf_failed'), 'err');
          save(dataUrlToBlob('data:application/pdf;base64,' + r.pdf), `${base}.pdf`);
        } else {
          return status(T('panel_pdf_failed'), 'err');
        }
      } catch (e) {
        return status(T('panel_pdf_failed'), 'err');
      }
      status(T('panel_done_kb').replace('{n}', Math.round(total / 1024)), 'okc');
      autoClose(3000);
    };
  }

  // ---- COMPRESS (R6) ------------------------------------------------------
  async function runCompress(preload) {
    await ensureReady();
    openPopup('COMPRESS', 'pop_compress');
    const inp = fileInput('image/*,application/pdf', preload, () => {});
    const md = document.createElement('div');
    const ml = document.createElement('span');
    label(ml, 'panel_maxsize');
    const max = document.createElement('input');
    max.type = 'number';
    max.value = '200';
    max.style.width = '70px';
    md.append(ml, ' ', max);
    body.appendChild(md);
    const go = document.createElement('button');
    label(go, 'pop_compress');
    const gd = document.createElement('div');
    gd.appendChild(go);
    body.appendChild(gd);

    go.onclick = async () => {
      const file = inp.files[0];
      if (!file) return status(T('panel_choose_image'), 'err');
      const budget = (parseInt(max.value, 10) || 200) * 1024;
      const base = baseName(file);
      try {
        if (isPdf(file)) {
          const r = await pdf('compress', { b64: await readDataUrl(file), budgetKB: budget / 1024 });
          if (!r.ok || !r.pdf) return status(T('panel_pdf_failed'), 'err');
          const out = dataUrlToBlob('data:application/pdf;base64,' + r.pdf);
          download(out, `${base}-compressed.pdf`);
          status(T('panel_done_kb').replace('{n}', Math.round(out.size / 1024)), 'okc');
        } else {
          const img = await loadImage(file);
          const targetType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
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
          download(blob, `${base}-compressed.${targetType === 'image/webp' ? 'webp' : 'jpg'}`);
          status(T('panel_done_kb').replace('{n}', Math.round(blob.size / 1024)), 'okc');
        }
      } catch (e) {
        return status(T('panel_pdf_failed'), 'err');
      }
      autoClose(3000);
    };
  }

  // ---- CLIENT -------------------------------------------------------------
  async function runClient() {
    await ensureReady();
    openPopup('CLIENT', 'panel_client');
    $('client').focus();
  }

  // ---- UPLOAD CAPTURE (R1) ------------------------------------------------
  const acceptOk = (f, accept) => {
    const parts = String(accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return true;
    const type = (f.type || '').toLowerCase();
    const name = f.name.toLowerCase();
    return parts.some((p) => (p.startsWith('.') ? name.endsWith(p) : p.endsWith('/*') ? type.startsWith(p.slice(0, -1)) : type === p));
  };

  const NAME_LABEL = /name|नाव|नाम/i;
  const NOT_APPLICANT = /father|mother|husband|relative|land|वडील|आई|पती|जमीन|पिता|माता/i;
  async function loadFormFields() {
    if (formFields) return;
    const r = await api('GET', '/api/form-fields?url=' + encodeURIComponent(location.href));
    formFields = { nameFields: r.nameFields || [], landHolderFields: r.landHolderFields || [], mrLookup: r.mrLookup || {}, lists: r.lists || {} };
  }
  const firstValue = (sels) => {
    for (const sel of sels) {
      let el = null;
      try { el = document.querySelector(sel); } catch (_) { /* bad selector */ }
      if (el && el.value && el.value.trim()) return el.value.trim();
    }
    return '';
  };
  const matchesAny = (el, sels) => sels.some((sel) => { try { return el.matches(sel); } catch (_) { return false; } });
  const isFallbackName = (el) => {
    const l = labelFor(el);
    return NAME_LABEL.test(l) && !NOT_APPLICANT.test(l);
  };
  function readForm() {
    const ff = formFields || { nameFields: [], landHolderFields: [] };
    let name = firstValue(ff.nameFields);
    if (!name) {
      for (const el of document.querySelectorAll('input')) {
        if (el.type === 'file' || el.type === 'hidden' || !el.value || !el.value.trim()) continue;
        if (isFallbackName(el)) { name = el.value.trim(); break; }
      }
    }
    return { name, landHolder: firstValue(ff.landHolderFields) };
  }
  /** Batch-check every stored upload against the form's name boxes; render per-document lines. Returns true if any problem line shown. */
  async function checkNames() {
    const list = Object.entries(uploads).map(([key, u]) => ({ key, docType: u.docType, doc: u.doc }));
    if (!list.length) return false;
    const r = await api('POST', '/api/check-names', { uploads: list, form: readForm(), lang: LANG });
    if (keyBad(r)) { line(T('pop_api_key'), 'err'); return true; }
    if (!r || r.error) return false;
    let problems = false;
    for (const [key, u] of Object.entries(uploads)) {
      if (u.docName) line(u.docName, '', true);
      const msgs = (r.perDoc && r.perDoc[key]) || [];
      if (msgs.length) { problems = true; for (const m of msgs) line(m, 'err'); }
      else if (u.valid !== false) line(T('upload_ok').replace('{f}', u.fileName), 'okc');
    }
    for (const m of r.notices || []) { problems = true; line(m, 'warn'); }
    return problems;
  }
  function attachNameListener() {
    if (nameListenerOn) return;
    nameListenerOn = true;
    document.addEventListener('change', async (e) => {
      const el = e.target;
      if (!el || !el.matches || !el.matches('input') || el.type === 'file') return;
      const ff = formFields || { nameFields: [], landHolderFields: [] };
      if (!(matchesAny(el, ff.nameFields) || matchesAny(el, ff.landHolderFields) || isFallbackName(el))) return;
      openPopup('UPLOAD', 'pop_upload');
      if (!(await checkNames())) autoClose(8000);
    }, true);
  }

  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input || !input.matches || !input.matches('input[type=file]') || !input.files || !input.files.length) return;
    const f = input.files[0];
    await ensureReady();
    await loadFormFields();
    openPopup('UPLOAD', 'pop_upload');
    status(T('upload_checking').replace('{f}', f.name), 'warn');

    let formatBad = false;
    if (!acceptOk(f, input.getAttribute('accept'))) {
      formatBad = true;
      const m = /\.([^.]+)$/.exec(f.name);
      line(T('upload_format_bad').replace('{f}', f.name).replace('{t}', (m ? m[1] : '').toUpperCase()).replace('{a}', input.getAttribute('accept')), 'err');
    }

    let imageBase64 = null;
    if (isPdf(f)) {
      const pr = await pdf('images', { b64: await readDataUrl(f), type: 'image/jpeg', maxPages: 1 });
      if (pr.ok && pr.pages && pr.pages[0]) imageBase64 = pr.pages[0];
    } else {
      imageBase64 = await readDataUrl(f);
    }

    let r = { ok: false, error: T('panel_pdf_failed') };
    if (imageBase64) {
      r = await api('POST', '/api/check-upload', {
        form: readForm(),
        label: labelFor(input) + ' ' + (input.name || '') + ' ' + (input.id || ''),
        fileName: f.name,
        imageBase64,
        lang: LANG,
      });
    }
    if (r.docType && r.doc) {
      uploads[input.id || input.name || 'upload'] = { docType: r.docType, doc: r.doc, fileName: f.name, docName: r.docName, valid: !!r.ok };
      attachNameListener();
    }
    if (r.docName) line(r.docName, '', true);
    for (const x of r.errors || []) line(x.message, 'err');
    for (const x of r.notices || []) line(x.message, 'warn');
    const nameProblems = r.docType && r.doc ? await checkNames() : false;

    const brow = document.createElement('div');
    const cv = document.createElement('button');
    label(cv, 'pop_convert');
    cv.onclick = () => runFormat(f);
    const cp = document.createElement('button');
    label(cp, 'pop_compress');
    cp.onclick = () => runCompress(f);
    brow.append(cv, ' ', cp);
    body.appendChild(brow);

    if (r.error) status(apiErr(r, r.error), 'err');
    else status('');
    if (r.ok && !formatBad && !nameProblems) autoClose(8000);
  }, true);
})();
