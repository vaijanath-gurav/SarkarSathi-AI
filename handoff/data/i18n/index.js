// DEV 3 OWNS THIS.
// Pre-written catalog, never runtime translation: instant, and it cannot hallucinate.

import en from './en.json' with { type: 'json' };
import hi from './hi.json' with { type: 'json' };
import mr from './mr.json' with { type: 'json' };

const CATALOGS = { en, hi, mr };

/**
 * @param {'en'|'hi'|'mr'} lang
 * @param {string} key
 * @param {object} params  values interpolated into {placeholders}
 */
export function t(lang, key, params = {}) {
  const catalog = CATALOGS[lang] || CATALOGS.en;
  let s = catalog[key] ?? CATALOGS.en[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export const LANGUAGES = Object.keys(CATALOGS);
