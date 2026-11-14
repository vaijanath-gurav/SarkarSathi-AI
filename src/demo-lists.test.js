// Run: node src/demo-lists.test.js  -- the demo portal's taluka/village endpoints.
import express from 'express';
import { web } from './web.js';

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };

const app = express();
app.use(web);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (u) => fetch(base + u).then((r) => r.json());

console.log('\nDemo portal list endpoints');
const t = await get('/en/StateGovEWS/District_SelectedState?Sel_DistrictName=521&strLang=2');
check('521 -> 5 talukas, Haveli 4101 first', t.length === 5 && t[0].Value === '4101' && t[0].Text === 'हवेली');
check('unknown district -> []', (await get('/en/StateGovEWS/District_SelectedState?Sel_DistrictName=999&strLang=2')).length === 0);
check('__proto__ -> []', (await get('/en/StateGovEWS/District_SelectedState?Sel_DistrictName=__proto__')).length === 0);
const v = await get('/en/StateGovEWS/Taluka_SelectedState?Sel_TalukaName=4101&strLang=2');
check('4101 -> 4 villages', v.length === 4 && v[1].Value === '410102');
const ff = await get('/api/form-fields?url=' + encodeURIComponent('http://localhost:3000/portal-ews.html'));
check('form-fields carries mrLookup + lists', ff.mrLookup?.ddl_RelationGender_Value && ff.lists?.genderMr && ff.lists?.districtsMr);
const none = await get('/api/form-fields?url=' + encodeURIComponent('http://example.com/x'));
check('uncurated url -> empty objects', Object.keys(none.mrLookup).length === 0 && Object.keys(none.lists).length === 0);

server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
