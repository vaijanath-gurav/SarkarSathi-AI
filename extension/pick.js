// Phase 10: choose a <select> option by its VISIBLE TEXT. Pure, no DOM access.
// Loaded as a content script before content.js; tested in Node by src/pick.test.js.
// Option values on the real portal differ per language (gender GUIDs) or are codes
// (district 521 = Pune = पुणे), so text is the only stable key.
(function (root) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[,./()\-:]+/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * @param {Array<{value:string,text:string}>} options
   * @param {{mode:'oneOf',candidates:string[]}|{mode:'within',source:string}} spec
   * @returns {string|null} the option value to select, or null if no single clear match
   */
  function pickOption(options, spec) {
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
      if (!hits.length) return null;
      // Longest match wins; a tie is ambiguous and left to the operator.
      const max = Math.max(...hits.map((o) => norm(o.text).length));
      const best = hits.filter((o) => norm(o.text).length === max);
      return best.length === 1 ? best[0].value : null;
    }

    return null;
  }

  root.__govtechPick = { pickOption };
})(globalThis);
