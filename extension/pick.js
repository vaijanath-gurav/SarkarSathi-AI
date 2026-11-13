// Phase 10: choose a <select> option by its VISIBLE TEXT. Pure, no DOM access.
// Loaded as a content script before content.js; tested in Node by src/pick.test.js.
// Option values on the real portal differ per language (gender GUIDs) or are codes
// (district 521 = Pune = पुणे), so text is the only stable key.
(function (root) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[,./()\-:]+/g, ' ').replace(/\s+/g, ' ').trim();

  const CONS = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h' };
  const VOW = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri' };
  const MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri' };

  // Rule-based Devanagari -> lowercase Latin. Word-final schwa is dropped; the fuzzy
  // match tolerates the remaining imprecision.
  function translit(s) {
    const chars = [...String(s || '')];
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (CONS[c] !== undefined) {
        out += CONS[c];
        let j = i + 1;
        if (chars[j] === '़') j++;
        const n = chars[j];
        if (n === '्') { i = j; }
        else if (MATRA[n] !== undefined) { out += MATRA[n]; i = j; }
        else {
          i = j - 1;
          const wordEnd = n === undefined || !(CONS[n] !== undefined || VOW[n] !== undefined || n === 'ं' || n === 'ँ' || n === 'ः');
          if (!wordEnd) out += 'a';
        }
      } else if (VOW[c] !== undefined) out += VOW[c];
      else if (MATRA[c] !== undefined) out += MATRA[c];
      else if (c === 'ं' || c === 'ँ') out += 'n';
      else if (c === 'ः') out += 'h';
      else if (c === '्' || c === '़') { /* ignored */ }
      else out += c.toLowerCase();
    }
    return out;
  }

  const latinKey = (s) => String(s || '').toLowerCase().replace(/w/g, 'v').replace(/ee/g, 'i').replace(/oo/g, 'u')
    .replace(/aa/g, 'a').replace(/gaon/g, 'gav').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

  function sim(a, b) {
    const m = a.length, n = b.length;
    if (!m && !n) return 1;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  /**
   * @param {Array<{value:string,text:string}>} options
   * @param {{mode:'oneOf',candidates:string[]}|{mode:'within',source:string}} spec
   * @returns {string|null} the option value to select, or null if no single clear match
   */
  function pickOption(options, spec) {
    pickOption.lastFuzzy = false;
    const real = options.filter((o) => o.value !== '' && norm(o.text));

    if (spec.mode === 'oneOf') {
      const want = (spec.candidates || []).map(norm);
      const hits = real.filter((o) => want.includes(norm(o.text)));
      return hits.length === 1 ? hits[0].value : null;
    }

    if (spec.mode === 'within') {
      const src = norm(spec.source);
      if (!src) return null;
      // Whole words only: "वड" must not match inside "वडगाव".
      const padded = ` ${src} `;
      const hits = real.filter((o) => padded.includes(` ${norm(o.text)} `));
      if (!hits.length) {
        // Devanagari source against Latin options: transliterate and fuzzy-match.
        const dev = /[ऀ-ॿ]/;
        if (!dev.test(spec.source) || !real.some((o) => !dev.test(o.text))) return null;
        const srcTokens = latinKey(translit(spec.source)).split(' ').filter(Boolean);
        if (!srcTokens.length) return null;
        const scored = [];
        for (const o of real) {
          if (dev.test(o.text)) continue;
          const toks = latinKey(o.text).split(' ').filter(Boolean);
          if (!toks.length) continue;
          const score = Math.min(...toks.map((t) => Math.max(...srcTokens.map((s) => sim(t, s)))));
          if (score >= 0.75) scored.push({ o, score });
        }
        scored.sort((a, b) => b.score - a.score);
        if (!scored.length) return null;
        if (scored.length > 1 && !(scored[0].score > scored[1].score)) return null;
        pickOption.lastFuzzy = true;
        return scored[0].o.value;
      }
      // Longest match wins; a tie is ambiguous and left to the operator.
      const max = Math.max(...hits.map((o) => norm(o.text).length));
      const best = hits.filter((o) => norm(o.text).length === max);
      return best.length === 1 ? best[0].value : null;
    }

    return null;
  }

  root.__govtechPick = { pickOption, translit };
})(globalThis);
