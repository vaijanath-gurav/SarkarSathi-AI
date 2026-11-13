// Run: npm run test:rules
// Works right now with zero AI, zero WhatsApp. Dev 4 lives in this file.

import fs from 'node:fs';
import { validateEWS, namesMatch, monthsSince, parseHectares, toAsciiDigits, validateDocument, checkAgainstForm, resolveNames } from './rulebook.js';

const load = (f) => JSON.parse(fs.readFileSync(`fixtures/${f}.json`, 'utf8'));
const NOW = new Date('2026-11-13');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

console.log('\nName matching');
check('identical names match', namesMatch('Ramesh Shankar Patil', 'Ramesh Shankar Patil'));
check('honorific ignored', namesMatch('Shri Ramesh Shankar Patil', 'Ramesh Shankar Patil'));
check('case ignored', namesMatch('RAMESH SHANKAR PATIL', 'ramesh shankar patil'));
check('minor transliteration tolerated', namesMatch('Ramesh Shankar Patil', 'Ramesh Shankar Pati'));
check('different surname rejected', !namesMatch('Ramesh Shankar Patil', 'Ramesh Shankar Pawar'));
check('empty rejected', !namesMatch('', 'Ramesh Shankar Patil'));

console.log('\nDate maths');
check('April 2026 is ~7 months before Nov 2026', monthsSince('2026-04-18', NOW) === 6 || monthsSince('2026-04-18', NOW) === 7);
check('NULL returns null', monthsSince('NULL', NOW) === null);

console.log('\nHappy path');
const good = validateEWS({
  identity: load('identity'), income: load('income'), land: load('land'), purpose: 'School admission',
}, NOW);
check('clean profile passes', good.ok === true);
check('no errors', good.errors.length === 0);

console.log('\nDEMO CASE: planted name mismatch');
const bad = validateEWS({
  identity: load('identity'), income: load('income'), land: load('land_mismatch'), purpose: 'School admission',
}, NOW);
check('mismatch is caught', bad.ok === false);
check('error key is name_mismatch', bad.errors.some((e) => e.key === 'name_mismatch'));

console.log('\nMissing documents');
const partial = validateEWS({ identity: load('identity') }, NOW);
check('reports income + land missing', partial.missing.includes('income') && partial.missing.includes('land'));

console.log('\nStale income certificate');
const stale = validateEWS({
  identity: load('identity'),
  income: { ...load('income'), issue_date: '2024-01-10' },
  land: load('land'), purpose: 'School admission',
}, NOW);
check('stale certificate caught', stale.errors.some((e) => e.key === 'income_stale'));

console.log('\nIncome above ceiling');
const rich = validateEWS({
  identity: load('identity'),
  income: { ...load('income'), certified_annual_income: '1200000' },
  land: load('land'), purpose: 'School admission',
}, NOW);
check('over-ceiling income caught', rich.errors.some((e) => e.key === 'income_too_high'));

console.log('\nCross-script matching (ADR-8)');
// The real-world case: Aadhaar prints Latin, the 7/12 is Devanagari-only.
check('transliteration variance tolerated (Patil vs Paatil)',
  namesMatch('Ramesh Shankar Patil', 'Ramesh Shankar Paatil'));
check('raw Devanagari vs Latin does NOT match without a latin variant',
  !namesMatch('रमेश शंकर पाटील', 'Ramesh Shankar Patil'));

const crossScript = validateEWS({
  identity: load('identity'),   // full_name Devanagari, full_name_latin Roman
  income: load('income'),
  land: load('land'),           // owner_names Devanagari, owner_names_latin "Paatil"
  purpose: 'School admission',
}, NOW);
check('cross-script profile passes via latin fields', crossScript.ok === true);

// Guard the failure mode this was built to prevent: comparing printed forms directly
// would score ~0% and falsely reject a legitimate applicant.
const noLatin = validateEWS({
  identity: { ...load('identity'), full_name_latin: undefined },
  income: load('income'),
  land: { ...load('land'), owner_names_latin: undefined },
  purpose: 'School admission',
}, NOW);
check('missing latin fields fall back without crashing', Array.isArray(noLatin.errors));

console.log('\nDEMO CASE still caught cross-script');
const badCross = validateEWS({
  identity: load('identity'), income: load('income'),
  land: load('land_mismatch'), purpose: 'School admission',
}, NOW);
check('Pawar vs Patil caught in latin form',
  badCross.errors.some((e) => e.key === 'name_mismatch'));
check('error reports the printed Devanagari name',
  badCross.errors.some((e) => String(e.params?.a).includes('रमेश')));

console.log('\nLand checks (Phase 9)');
check('Devanagari digits converted', toAsciiDigits('४५/२') === '45/2');
check('7/12 H.R.SqM area parsed', Math.abs(parseHectares('०.८१.००') - 0.81) < 1e-9);
check('plain hectares parsed', parseHectares('1.21') === 1.21);
check('NULL area is null', parseHectares('NULL') === null);

const base = { identity: load('identity'), income: load('income'), purpose: 'School admission' };
const big = validateEWS({ ...base, land: { ...load('land'), total_area_hectares: '2.50' } }, NOW);
check('land of 2.50 ha rejected', big.errors.some((e) => e.key === 'land_too_large'));
const noArea = validateEWS({ ...base, land: { ...load('land'), total_area_hectares: 'NULL' } }, NOW);
check('unreadable area is an error', noArea.errors.some((e) => e.key === 'land_area_unreadable'));
const noDate = validateEWS({ ...base, land: { ...load('land'), record_print_date: 'NULL' } }, NOW);
check('unreadable land date is an error', noDate.errors.some((e) => e.key === 'land_date_unreadable'));

const opLand = {
  ...load('land'), survey_number: null, total_area_hectares: null, record_print_date: null,
  needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'],
};
const op = validateEWS({ ...base, land: opLand }, NOW);
check('operator fields do not fail validation', op.ok === true);
check('operator notice raised', op.notices.some((e) => e.key === 'land_operator_entry'));
check('clean profile has no notices', good.notices.length === 0);

console.log('\nFormat (BUILD_SPEC §5.1 check 6)');
const withPin = (p) => validateEWS({ ...base, identity: { ...load('identity'), pin_code: p }, land: load('land') }, NOW);
check('5-digit PIN rejected', withPin('43171').errors.some((e) => e.key === 'pin_invalid'));
check('NULL PIN rejected', withPin('NULL').errors.some((e) => e.key === 'pin_invalid'));
check('Devanagari-digit PIN accepted', !withPin('४३१७१४').errors.some((e) => e.key === 'pin_invalid'));
const noSurvey = validateEWS({ ...base, land: { ...load('land'), survey_number: '' } }, NOW);
check('empty survey number rejected', noSurvey.errors.some((e) => e.key === 'survey_missing'));
check('operator-typed survey number exempt', !op.errors.some((e) => e.key === 'survey_missing'));
console.log('\nPer-document validation (Phase 14, upload capture)');
const vd = (type, doc, profile = {}) => validateDocument(type, doc, { profile, now: NOW });
check('Aadhaar alone passes', vd('identity', load('identity')).ok === true);
check('Aadhaar with bad PIN fails', vd('identity', { ...load('identity'), pin_code: '4317' }).errors.some((e) => e.key === 'pin_invalid'));
check('Aadhaar vs other person\'s 7/12 caught', vd('identity', load('identity'), { land: load('land_mismatch') }).errors.some((e) => e.key === 'name_mismatch'));
check('income certificate alone passes', vd('income', load('income')).ok === true);
check('stale income certificate caught', vd('income', { ...load('income'), issue_date: '2025-01-01' }).errors.some((e) => e.key === 'income_stale'));
check('income certificate of another person caught',
  vd('income', { ...load('income'), applicant_name: 'Suresh Kale', applicant_name_latin: 'Suresh Kale' }, { identity: load('identity') })
    .errors.some((e) => e.key === 'income_name_mismatch'));
check('7/12 of the same person passes', vd('land', load('land'), { identity: load('identity') }).ok === true);
check('operator-typed 7/12 numbers raise a notice, not an error', (() => {
  const r = vd('land', { ...load('land'), survey_number: null, total_area_hectares: null, record_print_date: null,
    needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'] });
  return r.ok === true && r.notices.some((n) => n.key === 'land_operator_entry');
})());

console.log('\nUpload vs NAME box on the same form');
const kale = { applicant_name: 'Suresh Kale', applicant_name_latin: 'Suresh Kale' };
check('income vs matching form name passes', checkAgainstForm('income', load('income'), { name: 'Ramesh Shankar Patil' }).length === 0);
check('income of another person vs form name caught', (() => { const e = checkAgainstForm('income', { ...load('income'), ...kale }, { name: 'Ramesh Shankar Patil' }); return e.length === 1 && e[0].key === 'form_name_mismatch'; })());
check('Aadhaar vs different form name caught', checkAgainstForm('identity', load('identity'), { name: 'Suresh Kale' }).some((e) => e.key === 'form_name_mismatch'));
check('7/12 vs form name passes (Paatil ~ Patil)', checkAgainstForm('land', load('land'), { name: 'Ramesh Shankar Patil' }).length === 0);
check('7/12 checked against the land holder box', checkAgainstForm('land', load('land'), { name: 'Ramesh Shankar Patil', landHolder: 'Suresh Kale' }).some((e) => e.key === 'form_name_mismatch'));
check('Devanagari form name compared with printed Devanagari name', checkAgainstForm('identity', load('identity'), { name: 'रमेश शंकर पाटील' }).length === 0);
check('empty form raises nothing', ['identity', 'income', 'land'].every((t) => checkAgainstForm(t, load(t), {}).length === 0));

check('income naming several people matches ANY of them', checkAgainstForm('income', { applicant_name: 'Jaywant Janardhan Kasabale', applicant_name_latin: 'Jaywant Janardhan Kasabale', other_names_latin: ['Jitesh Jaywant Kasabale'] }, { name: 'Jitesh Jaywant Kasabale' }).length === 0);
check('wrong form name: income + 7/12 agree with each other -> one notice, documents not blamed', (() => {
  const r = resolveNames([{ key: 'a', docType: 'income', doc: load('income') }, { key: 'b', docType: 'land', doc: load('land') }], { name: 'Rmesh Pateel' });
  return r.notices.length === 1 && r.notices[0].key === 'form_name_suspect' && Object.keys(r.perDoc).length === 0;
})());
check('odd document out is blamed, not the form', (() => {
  const r = resolveNames([{ key: 'a', docType: 'identity', doc: load('identity') }, { key: 'b', docType: 'income', doc: { ...load('income'), ...kale } }], { name: 'Ramesh Shankar Patil' });
  return Object.keys(r.perDoc).join() === 'b' && r.notices.length === 0;
})());
check('single mismatching document is blamed', (() => {
  const r = resolveNames([{ key: 'b', docType: 'income', doc: { ...load('income'), ...kale } }], { name: 'Ramesh Shankar Patil' });
  return Object.keys(r.perDoc).join() === 'b' && r.notices.length === 0;
})());
check('7/12 compared with the land holder box', (() => {
  const r = resolveNames([{ key: 'c', docType: 'land', doc: load('land') }], { name: 'Suresh Kale', landHolder: 'Ramesh Shankar Patil' });
  return !('c' in r.perDoc) && r.notices.length === 0;
})());
check('empty form: resolveNames raises nothing', (() => {
  const r = resolveNames([{ key: 'a', docType: 'identity', doc: load('identity') }, { key: 'b', docType: 'land', doc: load('land') }], {});
  return Object.keys(r.perDoc).length === 0 && r.notices.length === 0;
})());

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
