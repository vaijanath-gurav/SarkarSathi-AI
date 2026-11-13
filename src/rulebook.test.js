// Run: npm run test:rules
// Works right now with zero AI, zero WhatsApp. Dev 4 lives in this file.

import fs from 'node:fs';
import { validateEWS, namesMatch, monthsSince } from './rulebook.js';

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
