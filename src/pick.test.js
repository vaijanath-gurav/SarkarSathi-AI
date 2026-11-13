// Run: node src/pick.test.js
// Loads extension/pick.js (a browser content script) into a Node VM and tests it.
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('extension/pick.js', 'utf8'), ctx);
const { pickOption } = ctx.__govtechPick;

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };
const O = (rows) => [{ value: '', text: '---निवडा---' }, ...rows.map(([value, text]) => ({ value, text }))];

console.log('\nDistricts (within)');
const districts = O([['521', 'पुणे'], ['523', 'बीड'], ['527', 'सातारा']]);
check('पुणे found in "हवेली पुणे"', pickOption(districts, { mode: 'within', source: 'हवेली पुणे' }) === '521');
check('no district in "कंधार, नांदेड"', pickOption(districts, { mode: 'within', source: 'कंधार, नांदेड' }) === null);
check('empty source picks nothing', pickOption(districts, { mode: 'within', source: '' }) === null);
check('Latin, case-insensitive, inside an address',
  pickOption(O([['521', 'Pune'], ['523', 'Beed']]), { mode: 'within', source: 'Flat 2, Kothrud, PUNE 411038' }) === '521');

console.log('\nVillages (within)');
const villages = O([['v1', 'वडगाव'], ['v2', 'वडगाव शेरी'], ['v3', 'खडकवासला']]);
check('exact village beats a longer name not in the source', pickOption(villages, { mode: 'within', source: 'वडगाव' }) === 'v1');
check('longest whole match wins', pickOption(villages, { mode: 'within', source: 'वडगाव शेरी' }) === 'v2');
check('no match inside a word', pickOption(O([['x', 'वड']]), { mode: 'within', source: 'वडगाव' }) === null);

console.log('\nGender (oneOf)');
check('English page: MALE -> M',
  pickOption(O([['g1', 'M'], ['g2', 'F'], ['g3', 'T']]), { mode: 'oneOf', candidates: ['M', 'Male', 'पुरुष'] }) === 'g1');
check('Marathi page: FEMALE -> स्त्री',
  pickOption(O([['m1', 'पुरुष'], ['m2', 'स्त्री'], ['m3', 'इतर']]), { mode: 'oneOf', candidates: ['F', 'Female', 'स्त्री', 'महिला'] }) === 'm2');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
