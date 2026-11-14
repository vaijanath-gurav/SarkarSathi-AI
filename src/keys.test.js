// Run: node src/keys.test.js  -- API keys, per-key usage counting, CORS, admin usage route.
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.KEYS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-test-'));
delete process.env.ADMIN_KEY;

const { web } = await import('./web.js');
const { createKey, usage } = await import('./keys.js');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(web);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (method, url, { key, headers = {}, body } = {}) => fetch(base + url, {
  method,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-Api-Key': key } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
const flush = () => new Promise((r) => setTimeout(r, 100)); // 'finish' fires just after the client has the response
const nowDate = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

console.log('\ncreateKey');
const key = createKey('CSC Test 1');
check('format csc_ + 32 hex', /^csc_[0-9a-f]{32}$/.test(key));
const stored = JSON.parse(fs.readFileSync(path.join(process.env.KEYS_DIR, 'keys.json'), 'utf8'));
check('name stored', stored[key]?.name === 'CSC Test 1' && !!stored[key].created);

console.log('\nKey required');
const names = { uploads: [], form: {} };
let r = await call('POST', '/api/check-names', { body: names });
check('no key -> 401 api_key_missing', r.status === 401 && (await r.json()).error === 'api_key_missing');
r = await call('POST', '/api/check-names', { key: 'csc_bad', body: names });
check('bad key -> 401 api_key_invalid', r.status === 401 && (await r.json()).error === 'api_key_invalid');

console.log('\nCounting');
r = await call('POST', '/api/check-names', { key, body: names });
check('valid key -> 200', r.status === 200);
await flush();
const row = () => usage().find((x) => x.key === key && x.date === nowDate());
check('names = 1 today', row()?.counts.names === 1);
await call('POST', '/api/check-names', { key, body: names });
await flush();
check('names = 2 after second call', row()?.counts.names === 2 && row().total === 2);
r = await call('POST', '/api/stt', { key, body: {} });
await flush();
check('failed request (400) is not counted', r.status === 400 && row().counts.voice === undefined && row().total === 2);
check('usage.json persisted', JSON.parse(fs.readFileSync(path.join(process.env.KEYS_DIR, 'usage.json'), 'utf8'))[key][nowDate()].names === 2);

console.log('\nFree routes and citizen data');
check('/api/strings without key', (await call('GET', '/api/strings?lang=en')).status === 200);
check('/api/form-fields without key', (await call('GET', '/api/form-fields?url=x')).status === 200);
r = await call('GET', '/api/clients');
check('/api/clients without key -> 401', r.status === 401);
r = await call('GET', '/api/whoami', { key });
check('whoami returns the CSC name', (await r.json()).name === 'CSC Test 1');
check('whoami is not counted', (await flush(), row().total === 2));

console.log('\n/api/usage');
r = await call('GET', '/api/usage');
check('no ADMIN_KEY env -> 503', r.status === 503);
process.env.ADMIN_KEY = 'secret-admin';
r = await call('GET', '/api/usage', { headers: { 'X-Admin-Key': 'wrong' } });
check('wrong admin key -> 401', r.status === 401);
r = await call('GET', '/api/usage', { headers: { 'X-Admin-Key': 'secret-admin' } });
const j = await r.json();
check('right admin key -> rows include the CSC name', r.status === 200 && j.rows.some((x) => x.name === 'CSC Test 1'));

console.log('\nCORS');
r = await call('GET', '/api/strings', { headers: { Origin: 'chrome-extension://abc' } });
check('extension origin echoed', r.headers.get('access-control-allow-origin') === 'chrome-extension://abc' && /X-Api-Key/.test(r.headers.get('access-control-allow-headers')));
r = await call('GET', '/api/strings', { headers: { Origin: 'https://evil.example' } });
check('other origin gets no ACAO', r.headers.get('access-control-allow-origin') === null);
r = await call('OPTIONS', '/api/fill', { headers: { Origin: 'https://evil.example' } });
check('OPTIONS other origin -> 204, no CORS headers', r.status === 204 && r.headers.get('access-control-allow-origin') === null);
r = await call('OPTIONS', '/api/fill', { headers: { Origin: 'chrome-extension://abc' } });
check('OPTIONS extension origin -> 204 with CORS', r.status === 204 && r.headers.get('access-control-allow-origin') === 'chrome-extension://abc');

console.log('\nRates and amounts');
{
  process.env.KEYS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-rates-'));
  const { createKey: ck, count, myUsage } = await import('./keys.js');
  const k2 = ck('Rates CSC');
  for (let i = 0; i < 3; i++) await count(k2, 'document');
  for (let i = 0; i < 2; i++) await count(k2, 'fill');
  for (let i = 0; i < 4; i++) await count(k2, 'voice');
  const u = myUsage(k2);
  check('todayTotal 9', u.todayTotal === 9);
  check('todayAmount 26', u.todayAmount === 26);
  check('monthAmount 26', u.monthAmount === 26);
  check('rates document 2, fill 10', u.rates.document === 2 && u.rates.fill === 10);
}

server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
