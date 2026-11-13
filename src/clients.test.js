// Operator-typed overrides flow back into the profile. Run: node src/clients.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'master-'));
process.env.MASTER_DIR = tmp;
fs.mkdirSync(path.join(tmp, 'ADHAAR'));
fs.mkdirSync(path.join(tmp, 'LAND RECORDS'));
fs.writeFileSync(path.join(tmp, 'LAND RECORDS', 'T.json'), JSON.stringify({
  owner_names_latin: ['A B'], survey_number: null, total_area_hectares: null, record_print_date: null,
  needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'],
}));
const { setOverride, getProfile } = await import('./clients.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

console.log('\nOperator overrides');
await setOverride('T', 'land.survey_number', '45/2');
let p = await getProfile('T');
check('override value appears in profile', p.land.survey_number === '45/2');
check('overridden field leaves needs_operator', !p.land.needs_operator.includes('survey_number'));
await setOverride('T', 'land.total_area_hectares', '0.8094');
p = await getProfile('T');
check('area override applied and only one field still needs operator',
  p.land.total_area_hectares === '0.8094' && p.land.needs_operator.length === 1);
let rejected = false;
try { await setOverride('T', 'identity.full_name', 'X'); } catch (e) { rejected = e.message === 'path not allowed'; }
check('disallowed path rejected', rejected);
await setOverride('T', 'land.survey_number', '');
p = await getProfile('T');
check('empty value removes override', p.land.survey_number === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
