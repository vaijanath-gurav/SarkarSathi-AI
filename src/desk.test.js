// Run: node src/desk.test.js  -- desk app server side: status, whoami, my-usage.
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
process.env.MASTER_DIR = tmp('desk-master-');
process.env.DATA_DIR = tmp('desk-data-');
process.env.KEYS_DIR = tmp('desk-keys-');
process.env.USE_MOCK = 'true';
process.env.OLLAMA_URL = 'http://127.0.0.1:1'; // nothing listens: status booleans are false
process.env.STT_URL = 'http://127.0.0.1:1';

const { web } = await import('./web.js');
const { createKey } = await import('./keys.js');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(web);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (method, url, { key, body } = {}) => fetch(base + url, {
  method,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-Api-Key': key } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const flush = () => new Promise((r) => setTimeout(r, 150));

const key = createKey('Desk CSC');
const key2 = createKey('Other CSC');
let r, j;

console.log('\n1. Status');
r = await call('GET', '/api/status');
j = await r.json();
check('free, three booleans', r.status === 200 && j.server === true && typeof j.ai === 'boolean' && typeof j.voice === 'boolean' && typeof j.aiModel === 'string');

console.log('\n2. Who am I');
check('whoami needs a key', (await call('GET', '/api/whoami')).status === 401);
j = await (await call('GET', '/api/whoami', { key })).json();
check('whoami returns the CSC name', j.ok === true && j.name === 'Desk CSC');

console.log('\n3. My usage');
await call('POST', '/api/check-names', { key, body: { uploads: [], form: {} } });
await call('POST', '/api/check-names', { key: key2, body: { uploads: [], form: {} } });
await flush();
j = await (await call('GET', '/api/my-usage', { key })).json();
check('own name and counts only', j.name === 'Desk CSC' && j.today.names === 1 && j.todayTotal >= 1 && j.monthTotal >= j.todayTotal);
j = await (await call('GET', '/api/my-usage', { key: key2 })).json();
check('other key sees only its own', j.name === 'Other CSC' && j.today.names === 1 && j.todayTotal === 1);
check('my-usage needs a key', (await call('GET', '/api/my-usage')).status === 401);

server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
