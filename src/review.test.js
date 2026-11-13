// Run: node src/review.test.js
import fs from 'node:fs';
import { buildReviewSummary, applyReviewReply } from './review.js';

const load = (f) => JSON.parse(fs.readFileSync(`fixtures/${f}.json`, 'utf8'));
const makeProfile = () => ({
  identity: load('identity'), income: load('income'), land: load('land'),
  purpose: 'School admission',
});

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

console.log('\nSummary rendering');
const en = buildReviewSummary(makeProfile(), 'en');
check('numbers every field', /1\./.test(en) && /6\./.test(en));
check('shows the name', en.includes('Ramesh Shankar Patil'));
check('shows the purpose', en.includes('School admission'));

const mr = buildReviewSummary(makeProfile(), 'mr');
check('renders in Marathi', mr.includes('नाव'));
check('value stays as printed', mr.includes('Ramesh Shankar Patil'));

console.log('\nConfirmation');
check('ok confirms', applyReviewReply(makeProfile(), 'ok').action === 'confirm');
check('OK uppercase confirms', applyReviewReply(makeProfile(), 'OK').action === 'confirm');
check('Marathi होय confirms', applyReviewReply(makeProfile(), 'होय').action === 'confirm');

console.log('\nCorrections');
const p1 = makeProfile();
const r1 = applyReviewReply(p1, '1 Ramesh Shankar Pati');
check('field 1 corrected', r1.action === 'corrected');
check('name actually changed', p1.identity.full_name === 'Ramesh Shankar Pati');

const p2 = makeProfile();
applyReviewReply(p2, '6 Education loan');
check('purpose corrected', p2.purpose === 'Education loan');

const p3 = makeProfile();
applyReviewReply(p3, '4. 195000');
check('dot separator works', p3.income.certified_annual_income === '195000');

const p4 = makeProfile();
applyReviewReply(p4, '1 रमेश शंकर पाटील');
check('Devanagari correction accepted', p4.identity.full_name === 'रमेश शंकर पाटील');

console.log('\nBad input');
check('out of range rejected', applyReviewReply(makeProfile(), '99 x').action === 'unparsed');
check('gibberish rejected', applyReviewReply(makeProfile(), 'hello there').action === 'unparsed');
check('empty rejected', applyReviewReply(makeProfile(), '').action === 'unparsed');
check('number alone rejected', applyReviewReply(makeProfile(), '3').action === 'unparsed');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
