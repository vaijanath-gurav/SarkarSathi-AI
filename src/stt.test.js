// Run: node src/stt.test.js
// Covers the spoken-phrasing -> numeric-protocol mapping. Needs no audio and no model.
import { voiceToReviewReply } from './stt.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

console.log('\nAlready numeric');
check('passes "1 Ramesh Patil" through', voiceToReviewReply('1 Ramesh Patil') === '1 Ramesh Patil');
check('passes "4. 195000" through', voiceToReviewReply('4. 195000') === '4. 195000');

console.log('\nSpoken numbers');
check('"number three is Patil" drops the connector and keeps casing',
  voiceToReviewReply('number three is Patil') === '3 Patil');
check('"one Ramesh Patil"', voiceToReviewReply('one Ramesh Patil') === '1 Ramesh Patil');

console.log('\nField names');
check('"name is Ramesh Patil"', voiceToReviewReply('name is Ramesh Patil') === '1 Ramesh Patil');
check('"address is Kandhar"', voiceToReviewReply('address is Kandhar') === '3 Kandhar');
check('"purpose is school admission"',
  voiceToReviewReply('purpose is school admission') === '6 school admission');
check('"income 195000"', voiceToReviewReply('income 195000') === '4 195000');

console.log('\nMarathi field names');
check('"नाव रमेश पाटील आहे"', voiceToReviewReply('नाव रमेश पाटील आहे').startsWith('1 रमेश पाटील'));
check('"कारण शिक्षण"', voiceToReviewReply('कारण शिक्षण') === '6 शिक्षण');

console.log('\nConfirmations pass through untouched');
check('"ok" stays "ok"', voiceToReviewReply('ok') === 'ok');
check('"होय" stays "होय"', voiceToReviewReply('होय') === 'होय');

console.log('\nEdge cases');
check('empty returns null', voiceToReviewReply('') === null);
check('whitespace returns null', voiceToReviewReply('   ') === null);
check('out-of-range number not mapped', voiceToReviewReply('9 something') === '9 something');
check('unmatched prose passed through',
  voiceToReviewReply('I think this is wrong') === 'I think this is wrong');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
