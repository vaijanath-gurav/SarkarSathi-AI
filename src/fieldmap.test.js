// Run: node src/fieldmap.test.js
import fs from 'node:fs';
import { matchFields } from './fieldmap.js';

const L = (f) => JSON.parse(fs.readFileSync(`fixtures/${f}.json`, 'utf8'));
const profile = { identity: L('identity'), income: L('income'), land: L('land'), purpose: 'School admission' };

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };

const f = (ref, label, extra = {}) => ({ ref, label, name: '', id: '', placeholder: '', ...extra });

console.log('\nMarathi labels');
let v = matchFields({ profile, url: '', fields: [
  f('a', 'नाव'), f('b', 'पत्ता'), f('c', 'जिल्हा'), f('d', 'तहसील'), f('e', 'सर्व्हे नंबर'),
]});
check('name -> latin form', v.a === 'Ramesh Shankar Patil');
check('address filled', v.b.includes('Kandhar'));
check('district derived', v.c === 'नांदेड');
check('taluka derived', v.d === 'कंधार');
check('survey number', v.e === '142/2B');

console.log('\nEnglish labels');
v = matchFields({ profile, url: '', fields: [f('a', 'Applicant Name'), f('b', 'Annual Income'), f('c', 'Purpose')] });
check('name', v.a === 'Ramesh Shankar Patil');
check('income', v.b === '186000');
check('purpose', v.c === 'School admission');

console.log('\nSpecificity');
v = matchFields({ profile, url: '', fields: [f('a', 'Date of Birth'), f('b', 'Village Name')] });
check('dob not matched as name', v.a === '1982-07-14');
check('village not matched as name', v.b === 'कंधार');

console.log('\nNo guessing');
v = matchFields({ profile, url: '', fields: [f('a', 'Favourite colour'), f('b', ''), f('c', 'Mobile Number')] });
check('unknown label left alone', v.a === undefined);
check('empty label left alone', v.b === undefined);
check('mobile has no source, left alone', v.c === undefined);

console.log('\nCurated mapping wins');
v = matchFields({ profile, url: 'http://localhost:3000/portal.html',
  fields: [f('a', '', { id: 'surveyNo' })] });
check('matched by id with no label', v.a === '142/2B');

console.log('\nKeyword fallback covers what the curated map omits');
// #taluka and #district are intentionally absent from forms/mahaonline-income.json,
// because they are derived from land.taluka_and_district rather than being plain paths.
// On a curated page they must still fill correctly, via their labels.
v = matchFields({ profile, url: 'http://localhost:3000/portal.html',
  fields: [f('a', 'तहसील', { id: 'taluka' }), f('b', 'जिल्हा', { id: 'district' })] });
check('taluka and district still derived on a curated page',
  v.a === 'कंधार' && v.b === 'नांदेड');

console.log('\nDate auto-fill');
const today = new Date().toISOString().slice(0, 10);
v = matchFields({ profile, url: '', fields: [f('a', 'दिनांक'), f('b', 'Date of Birth')] });
check('date field gets today', v.a === today);
check('date keyword does NOT steal Date of Birth', v.b === '1982-07-14');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
