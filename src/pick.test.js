// Run: node src/pick.test.js
// Loads extension/pick.js (a browser content script) into a Node VM and tests it.
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('extension/pick.js', 'utf8'), ctx);
const { pickOption, translit, resolveCode } = ctx.__govtechPick;
const L = (rows) => rows.map(([value, text]) => ({ value, text }));
const demo = JSON.parse(fs.readFileSync('forms/demo-portal-lists.json', 'utf8'));
const form = JSON.parse(fs.readFileSync('forms/mahaonline-ews.json', 'utf8'));

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

console.log('\nEnglish portal, Devanagari source (fuzzy)');
const W = (opts, source) => pickOption(opts, { mode: 'within', source });
check('English district Pune from "हवेली पुणे"', W(O([['521', 'Pune'], ['523', 'Beed'], ['527', 'Satara']]), 'हवेली पुणे') === '521');
check('English taluka Haveli from "हवेली पुणे"', W(O([['4101', 'Haveli'], ['4102', 'Mulshi'], ['4104', 'Pune City']]), 'हवेली पुणे') === '4101');
check('English village Wadgaon from "वडगाव"', W(O([['v1', 'Wadgaon'], ['v2', 'Wadgaon Sheri'], ['v3', 'Khadakwasla']]), 'वडगाव') === 'v1');
check('English districts: no match for "कंधार, नांदेड"', W(O([['521', 'Pune'], ['523', 'Beed'], ['527', 'Satara']]), 'कंधार, नांदेड') === null);
check('Marathi options still exact', W(O([['521', 'पुणे']]), 'हवेली पुणे') === '521');
check('translit पुणे / हवेली', translit('पुणे') === 'pune' && translit('हवेली') === 'haveli');

console.log('\nGender (oneOf)');
check('English page: MALE -> M',
  pickOption(O([['g1', 'M'], ['g2', 'F'], ['g3', 'T']]), { mode: 'oneOf', candidates: ['M', 'Male', 'पुरुष'] }) === 'g1');
check('Marathi page: FEMALE -> स्त्री',
  pickOption(O([['m1', 'पुरुष'], ['m2', 'स्त्री'], ['m3', 'इतर']]), { mode: 'oneOf', candidates: ['F', 'Female', 'स्त्री', 'महिला'] }) === 'm2');

console.log('\nresolveCode against OUR stored lists');
const distList = L([['521', 'पुणे'], ['523', 'बीड'], ['527', 'सातारा']]);
check('district: within "हवेली पुणे" -> 521', resolveCode(distList, { mode: 'within', source: 'हवेली पुणे' })?.code === '521');
const pune = resolveCode(distList, { mode: 'within', source: 'Pune' });
check('Latin Pune vs Devanagari list -> 521, fuzzy', pune?.code === '521' && pune.fuzzy === true);
check('Latin Haveli vs talukas of 521 -> 4101 fuzzy', (() => { const h = resolveCode(L(demo.talukas['521']), { mode: 'within', source: 'Haveli' }); return h?.code === '4101' && h.fuzzy; })());
check('Latin Vadgaon Sheri vs villages of 4101 -> 410102', resolveCode(L(demo.villages['4101']), { mode: 'within', source: 'Vadgaon Sheri' })?.code === '410102');
const gl = L(Object.entries(form.genderMr));
const M = '11d79d04-3bcf-4389-9466-7e4ac80a5f5d', F = '3665f1da-cdc8-4443-8649-c70563ec758f';
const G = (t) => resolveCode(gl, { mode: 'oneOf', candidates: [t], gender: true })?.code ?? null;
check('gender male/Male/पुरुष/purush -> पुरुष code', ['male', 'Male', 'पुरुष', 'purush'].every((t) => G(t) === M));
check('gender mahila -> स्त्री code', G('mahila') === F);
check('gender xyz -> null', G('xyz') === null);
const pageEn = L([['521', 'Pune'], ['523', 'Beed']]);
const tr = resolveCode(L(Object.entries(form.districtsMr)), { mode: 'within', source: 'पुणे' });
check('translated page (same codes, English text): our list gives 521 and the page has it', tr?.code === '521' && pageEn.some((o) => o.value === tr.code));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
