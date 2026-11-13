// Run: node src/stt-post.test.js
// Voice post-processing: digit normalisation and the name-field sentence guard.

import { postProcessTranscript } from './web.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

console.log('\nDigits');
check('hyphenated Aadhaar -> plain digits', postProcessTranscript('9768-7312-1335', 'Aadhar No').text === '976873121335');
check('comma separated Aadhaar -> plain digits', postProcessTranscript('9768, 7312, 1335', 'Aadhar No').text === '976873121335');
check('Devanagari digits -> ASCII', postProcessTranscript('४३१७१४', 'Pincode').text === '431714');

console.log('\nName guard');
const junk = postProcessTranscript('so why are we, its time to end this.', 'Full Name(English)');
check('sentence rejected on name field', junk.rejected === 'not_a_name' && junk.text === '');
check('real name kept, trailing period stripped', postProcessTranscript('Sarvesh Chokkar.', 'Full Name(English)').text === 'Sarvesh Chokkar');
check('non-name field passes through', postProcessTranscript('मराठा', 'जात').text === 'मराठा');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
