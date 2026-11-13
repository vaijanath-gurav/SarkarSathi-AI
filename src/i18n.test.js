// Run: node src/i18n.test.js
// Catalogs drifting apart is the classic i18n failure: a missing key silently falls back
// to English, so the bot answers a Marathi user in English on one error path only — and
// nobody notices until the demo.
import fs from 'node:fs';
import { t, LANGUAGES } from './i18n/index.js';
import { REVIEW_FIELDS } from './review.js';

const load = (l) => JSON.parse(fs.readFileSync(`src/i18n/${l}.json`, 'utf8'));

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

const catalogs = Object.fromEntries(LANGUAGES.map((l) => [l, load(l)]));
const enKeys = Object.keys(catalogs.en).sort();

console.log('\nRegistered languages');
check('en, hi and mr are all registered', ['en', 'hi', 'mr'].every((l) => LANGUAGES.includes(l)));

console.log('\nKey parity');
for (const lang of LANGUAGES) {
  const keys = Object.keys(catalogs[lang]).sort();
  const missing = enKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !enKeys.includes(k));
  check(`${lang}: no missing keys${missing.length ? ' -> ' + missing.join(', ') : ''}`, missing.length === 0);
  check(`${lang}: no extra keys${extra.length ? ' -> ' + extra.join(', ') : ''}`, extra.length === 0);
}

console.log('\nNo untranslated strings');
for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
  const copied = enKeys.filter((k) => {
    const v = catalogs[lang][k];
    // Short labels can legitimately coincide; long sentences copied verbatim cannot.
    return typeof v === 'string' && v === catalogs.en[k] && v.length > 15;
  });
  check(`${lang}: nothing left in English${copied.length ? ' -> ' + copied.join(', ') : ''}`,
    copied.length === 0);
}

console.log('\nPlaceholders preserved');
for (const lang of LANGUAGES) {
  const broken = enKeys.filter((k) => {
    const want = (catalogs.en[k].match(/\{\w+\}/g) || []).sort().join(',');
    const got = (String(catalogs[lang][k]).match(/\{\w+\}/g) || []).sort().join(',');
    return want !== got;
  });
  check(`${lang}: all {placeholders} intact${broken.length ? ' -> ' + broken.join(', ') : ''}`,
    broken.length === 0);
}

console.log('\nEvery review field has a label');
for (const lang of LANGUAGES) {
  const missing = REVIEW_FIELDS.filter((f) => !catalogs[lang][f.label]);
  check(`${lang}: all field labels present`, missing.length === 0);
}

console.log('\nInterpolation works per language');
check('en interpolates', t('en', 'review_updated', { label: 'Name', value: 'X' }).includes('X'));
check('hi interpolates', t('hi', 'review_updated', { label: 'नाम', value: 'X' }).includes('X'));
check('mr interpolates', t('mr', 'review_updated', { label: 'नाव', value: 'X' }).includes('X'));
check('unknown language falls back to en', t('zz', 'f_name') === catalogs.en.f_name);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
