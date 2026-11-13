// Run: node src/fieldmap.test.js
import fs from 'node:fs';
import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs } from './fieldmap.js';

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

console.log('\nOperator entry (Phase 9)');
const opProfile = { ...profile, land: {
  ...profile.land, survey_number: null, total_area_hectares: null, record_print_date: null,
  needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'],
}};
const opFields = [f('a', 'सर्व्हे नंबर'), f('b', 'क्षेत्र'), f('c', 'नाव')];
check('survey and area flagged for operator, name not',
  operatorRefs({ profile: opProfile, url: '', fields: opFields }).join(',') === 'a,b');
const opVals = matchFields({ profile: opProfile, url: '', fields: opFields });
check('operator fields left empty by fill',
  opVals.a === undefined && opVals.b === undefined && opVals.c === 'Ramesh Shankar Patil');

console.log('\nReal EWS form (Phase 10)');
const EWS = 'https://rd.mahaonline.gov.in/mr/EWSSelftDeclaration/SelfDeclarationApplication?str=TEST';
const E = (ref, id) => f(ref, '', { id });
const ewsFields = [
  E('a', 'txt_relation_nameofBeneficaryEn'), E('b', 'txt_relation_nameofBeneficaryMar'),
  E('c', 'txt_RelationDOB'), E('d', 'txtlandHolder_Name'), E('e', 'txtLandHolder_nameLL'),
  E('g', 'txtgatno'), E('h', 'txt_IncomeFromOthers'), E('i', 'txt_BenFatherFullNameEng'),
  E('j', 'Address_ApplicantPincode'),
];
v = matchFields({ profile, url: EWS, fields: ewsFields });
check('EWS: beneficiary English name', v.a === 'Ramesh Shankar Patil');
check('EWS: Marathi name filled when Devanagari', v.b === 'रमेश शंकर पाटील');
check('EWS: DOB as DD/MM/YYYY', v.c === '14/07/1982');
check('EWS: land holder from 7/12 owners', v.d === 'Ramesh Shankar Paatil' && v.e === 'रमेश शंकर पाटील');
check('EWS: operator fields never filled', v.g === undefined && v.h === undefined);
check('EWS: no keyword guessing on curated page', v.i === undefined);
check('EWS: pincode', v.j === '431714');
check('EWS: operator list flagged',
  operatorRefs({ profile, url: EWS, fields: ewsFields }).join(',') === 'g,h');
const latinOnly = { ...profile, identity: { ...profile.identity, full_name: 'Ramesh Shankar Patil' } };
check('EWS: Marathi name left empty when not Devanagari',
  matchFields({ profile: latinOnly, url: EWS, fields: ewsFields }).b === undefined);
const chains = selectChains({ profile, url: EWS });
check('EWS: gender and land chains built',
  chains[0][0].candidates.includes('पुरुष') &&
  chains[2].map((s) => s.id).join(',') === 'ddlland_dist_Value,ddlland_subdist_Value,ddlland_vill_Value' &&
  chains[2][0].source === 'कंधार, नांदेड');
check('EWS: income check figure', hintRefs({ profile, url: EWS, fields: ewsFields }).h === '186000');
v = matchFields({ profile, url: 'http://localhost:3000/portal.html', fields: [
  E('x', 'applicantName'), f('y', 'तहसील', { id: 'taluka' }),
]});
check('old mock portal unaffected', v.x === 'Ramesh Shankar Patil' && v.y === 'कंधार');

console.log('\nADR-8 verify flags (Phase 14)');
const vr = verifyRefs({ profile, url: EWS, fields: [...ewsFields, E('k', 'txtLandHolder_nameLL')] });
check('Marathi beneficiary and 7/12 English owner always flagged; printed Marathi owner not',
  vr.includes('b') && vr.includes('d') && !vr.includes('k'));
check('English name flagged when not known to be printed', vr.includes('a'));
const printedProfile = { ...profile, identity: { ...profile.identity, full_name_latin_printed: true } };
check('English name not flagged when printed on the card',
  !verifyRefs({ profile: printedProfile, url: EWS, fields: ewsFields }).includes('a'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
