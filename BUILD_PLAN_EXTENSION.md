# Build Plan — CSC Operator Assistant (extension + local service)

**Audience:** builder subagents. **Decisions: all made. None delegated.**
Read `EXECUTION_PLAN.md` Section 0 first — the same execution rules apply verbatim.

---

## 0. Locked decisions

Do not revisit any of these.

| # | Decision | Rationale |
|---|---|---|
| D1 | **No Electron.** Background Node service (existing `src/server.js`) + Chrome MV3 extension. | Electron bundles Chromium — heavier, not lighter. It would add only a tray icon and an out-of-Chrome hotkey. Portals live in Chrome. |
| D2 | **No new npm or pip packages.** Current deps stay: `dotenv`, `express`, `pdf-lib`. | The venue network failed `npm install` twice. Every feature below is achievable without additions. |
| D3 | **Enrolment is a watched directory**, not an upload UI. | Document type comes from the folder name — classification solved for free. CSC operators already keep files this way. |
| D4 | **Extraction results are cached to disk** beside each source file. | 20s × 3 documents would stall the demo. Cached, client selection is instant. |
| D5 | **Keybind fills the whole form at once.** | User decision. Strongest "seamless" story. |
| D6 | **Voice transcripts are shown and confirmed before insertion.** | Whisper rendered फोन as पोज on the team's own recording. Nothing unverified reaches a government field. |
| D7 | **The voice panel also accepts typed text.** | PS says "voice-**and-chat**". Chat = the typed path. Not optional. |
| D8 | **Curated form mappings first, keyword matching as fallback.** | User decision. Generic DOM guessing fails unpredictably. |
| D9 | **Conversion is images only**: JPEG ↔ PNG ↔ WEBP, and image → PDF. Done in-browser with `<canvas>`; image→PDF uses `pdf-lib` server-side. | Zero new dependencies (D2). PDF→text and PDF→image would need libraries we cannot safely install. |
| D10 | **Compression is canvas quality-stepping** to hit a byte budget. | Zero dependencies. |
| D11 | **The extension never submits anything.** No click on submit, ever. | PS says "**pre**-submission". This is the product's core promise. |
| D12 | **The existing web page (`src/web.js`, `public/index.html`) stays, unchanged**, as a fallback demo surface. | Already working. Costs nothing. Insurance if the extension misbehaves on stage. |
| D13 | **Extension fetches go through the background service worker**, never directly from the content script. | Avoids mixed-content and CORS surprises on https portal pages. |
| D14 | **API routes send `Access-Control-Allow-Origin: *`.** | The service binds localhost only; this is a local tool. Without it every extension call fails. |
| D15 | Keybind is **Ctrl+Shift+F**. Panel language follows `?lang=`, default `en`. | — |

### Folder contract (exact names — do not normalise or rename)

```
MASTER/
  ADHAAR/              -> docType "identity"
  INCOME CERTIFICATE/  -> docType "income"
  LAND RECORDS/        -> docType "land"
```

Client key = filename without extension (`Ramesh_Patil.jpg` → `Ramesh_Patil`).
Cache file = same basename + `.json`, written **in the same folder**.
Accepted source extensions: `.jpg`, `.jpeg`, `.png`, `.webp`. Ignore everything else.

### PS coverage — verify before declaring done

| PS phrase | Mechanism |
|---|---|
| Multilingual | panel strings served from existing `src/i18n` catalogs via `/api/strings` |
| voice | `/api/stt` → confirm → insert (D6) |
| and chat | the same panel accepts typed text (D7) |
| form filling | keybind fill from verified profile (D5) |
| automated | directory watch + auto-extract + auto-validate; no manual classification |
| pre-submission | validation runs before the operator submits; we never submit (D11) |
| OCR validation | existing `validateEWS` rulebook, unchanged |
| Aadhaar / income / land | the three folders (D3) |

---

## PHASE 1 — Directory enrolment and client API

### 1.1 Create `src/clients.js`

```js
// D3/D4: enrolment is a watched directory, not an upload UI.
// Document type comes from the folder name, so no classification step is needed.
// Extraction is cached beside the source file, so selecting a client is instant.

import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from './extractor.js';

const MASTER = process.env.MASTER_DIR || path.join(process.cwd(), 'MASTER');

/** Exact folder names are a contract with the operator. Do not normalise. */
export const FOLDERS = {
  'ADHAAR': 'identity',
  'INCOME CERTIFICATE': 'income',
  'LAND RECORDS': 'land',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function ensureFolders() {
  for (const folder of Object.keys(FOLDERS)) {
    await fs.mkdir(path.join(MASTER, folder), { recursive: true });
  }
}

async function listSources(folder) {
  const dir = path.join(MASTER, folder);
  let entries = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ file: f, key: path.basename(f, path.extname(f)), dir }));
}

/** Cached extraction. Returns null if extraction has not happened yet. */
async function readCache(dir, key) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Extract one source file and cache the result. Safe to call repeatedly. */
export async function extractAndCache(dir, file, key, docType) {
  const cached = await readCache(dir, key);
  if (cached) return cached;

  const buffer = await fs.readFile(path.join(dir, file));
  const data = await extractDocument(buffer, docType);
  await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/** All known clients and which of their three documents are extracted. */
export async function listClients() {
  const clients = new Map();

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    for (const { file, key, dir } of await listSources(folder)) {
      if (!clients.has(key)) {
        clients.set(key, { name: key, documents: { identity: false, income: false, land: false } });
      }
      clients.get(key).documents[docType] = Boolean(await readCache(dir, key));
    }
  }

  return [...clients.values()].map((c) => ({
    ...c,
    ready: c.documents.identity && c.documents.income && c.documents.land,
  }));
}

/** The canonical profile for one client, built from cached extractions. */
export async function getProfile(key) {
  const profile = { identity: null, income: null, land: null, purpose: null };

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    const dir = path.join(MASTER, folder);
    profile[docType] = await readCache(dir, key);
  }
  return profile;
}

/**
 * Extract anything not yet cached. Called once at startup so the demo never waits.
 * Failures are logged and skipped: one unreadable file must not stop the rest.
 */
export async function warmAll() {
  await ensureFolders();
  let done = 0, failed = 0;

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    for (const { file, key, dir } of await listSources(folder)) {
      try {
        const before = await readCache(dir, key);
        await extractAndCache(dir, file, key, docType);
        if (!before) done++;
      } catch (err) {
        failed++;
        console.error(`[clients] ${folder}/${file}: ${err.message}`);
      }
    }
  }
  if (done || failed) console.log(`[clients] extracted ${done}, failed ${failed}`);
}
```

### 1.2 Create `MASTER` folders and a `.gitignore` entry

Append to `.gitignore`:
```
MASTER/
```

### 1.3 Verify

```bash
node -e "import('./src/clients.js').then(async m=>{await m.ensureFolders();console.log(JSON.stringify(await m.listClients()))})"
```
Expected, exactly:
```
[]
```
And the folders `MASTER/ADHAAR`, `MASTER/INCOME CERTIFICATE`, `MASTER/LAND RECORDS` must now exist.

---

## PHASE 2 — API surface for the extension

### 2.1 Edit `src/web.js` — add CORS (D14)

Immediately after `export const web = express.Router();` insert:

```js
// D14: the extension's service worker calls these routes from a different origin.
// The service binds localhost only, so a permissive header is appropriate here.
web.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

### 2.2 Edit `src/web.js` — add imports

Add to the existing import block:
```js
import { listClients, getProfile, warmAll } from './clients.js';
import { LANGUAGES } from './i18n/index.js';
import { matchFields } from './fieldmap.js';
```

### 2.3 Edit `src/web.js` — append these routes at the end of the file

```js
/** Panel strings. Reuses the existing catalogs so the extension is multilingual (PS). */
web.get('/api/strings', (req, res) => {
  const lang = LANGUAGES.includes(req.query.lang) ? req.query.lang : 'en';
  const keys = [
    'f_name', 'f_dob', 'f_address', 'f_income', 'f_survey', 'f_purpose',
    'all_clear', 'blurry_retry', 'listening', 'heard', 'voice_failed', 'voice_empty',
  ];
  res.json(Object.fromEntries(keys.map((k) => [k, t(lang, k)])));
});

web.get('/api/clients', async (_req, res) => {
  try {
    res.json(await listClients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

web.get('/api/clients/:key/profile', async (req, res) => {
  const profile = await getProfile(req.params.key);
  res.json(profile);
});

web.get('/api/clients/:key/validate', async (req, res) => {
  const lang = LANGUAGES.includes(req.query.lang) ? req.query.lang : 'en';
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
});

/** Re-scan the MASTER directory and extract anything new. */
web.post('/api/clients/refresh', async (_req, res) => {
  try {
    await warmAll();
    res.json({ ok: true, clients: await listClients() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * D5: the extension posts every field it found; we return what to put in each.
 * Body: { client, url, fields: [{ ref, label, name, id, placeholder, type }] }
 * Returns: { values: { ref: value }, matched: n, total: n }
 */
web.post('/api/fill', async (req, res) => {
  const { client, url, fields } = req.body || {};
  if (!client || !Array.isArray(fields)) {
    return res.status(400).json({ error: 'client and fields are required' });
  }

  const profile = await getProfile(client);
  const values = matchFields({ profile, url, fields });
  res.json({ values, matched: Object.keys(values).length, total: fields.length });
});

/** Proxy to the local STT service so the extension needs only one origin. */
web.post('/api/stt', async (req, res) => {
  const { audioBase64, lang } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required' });

  const buffer = Buffer.from(audioBase64.replace(/^data:[^,]+,/, ''), 'base64');
  try {
    const { transcribe } = await import('./stt.js');
    const result = await transcribe(buffer, lang || null);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[web/stt]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** D9: image -> PDF. Conversion between image formats happens in the extension. */
web.post('/api/to-pdf', async (req, res) => {
  const { imageBase64, mime } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

  const { PDFDocument } = await import('pdf-lib');
  const bytes = Buffer.from(imageBase64.replace(/^data:[^,]+,/, ''), 'base64');

  try {
    const doc = await PDFDocument.create();
    const img = (mime || '').includes('png')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const pdf = Buffer.from(await doc.save());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 2.4a Edit `src/server.js` — serve the `public/` folder

Find:
```js
app.use(web);
```
Replace with:
```js
app.use(web);
// The web router only maps '/' to index.html. Everything else under public/ — the mock
// portal, and anything added later — needs static serving. Mounted AFTER the router so
// the explicit '/' route still wins.
app.use(express.static('public'));
```

### 2.4 Edit `src/server.js` — warm the cache at startup

Inside the `if (process.env.NO_LISTEN !== 'true') {` block, immediately after the
existing `console.log` lines inside `app.listen(...)`, add:

```js
  // D4: extract anything new in MASTER/ so client selection is instant later.
  import('./clients.js').then((m) => m.warmAll()).catch((e) => console.error('[warm]', e.message));
```

### 2.5 Verify

```bash
NO_LISTEN=true node -e "import('./src/web.js').then(()=>console.log('web ok'))"
```
Expected: `web ok`

Then with the server running (`npm start`) in another terminal:
```bash
curl -s http://localhost:3000/api/clients
curl -s "http://localhost:3000/api/strings?lang=mr"
```
Expected: `[]` and a JSON object whose `f_name` value is `नाव`.

---

## PHASE 3 — Field matching

### 3.1 Create `src/fieldmap.js`

```js
// D8: curated mappings first, keyword matching as fallback.
// Deterministic throughout - no model is involved in deciding what goes in a field.
// Same principle as the rulebook: this must behave identically every time.

import fs from 'node:fs';
import path from 'node:path';

/** Read a value out of the profile by dotted path, e.g. "identity.full_name_latin". */
function read(profile, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), profile);
}

/** Curated per-form mappings live in forms/*.json and win over keyword matching. */
function loadForms() {
  const dir = path.join(process.cwd(), 'forms');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch {
    return [];
  }
}

/**
 * Keyword table. Order matters: the FIRST entry whose keyword appears in the field's
 * text wins, so put more specific keywords above more general ones.
 * Values are dotted profile paths, or a function for derived values.
 */
const KEYWORDS = [
  { words: ['जन्म', 'dob', 'birth', 'janma'],            path: 'identity.date_of_birth' },
  { words: ['मोबाईल', 'मोबाइल', 'mobile', 'phone'],       path: null },
  { words: ['पिन', 'pincode', 'pin code', 'pin'],         path: 'identity.pin_code' },
  { words: ['तहसील', 'तालुका', 'taluka', 'tehsil'],        derive: 'taluka' },
  { words: ['जिल्हा', 'जिला', 'district', 'dist'],          derive: 'district' },
  { words: ['गाव', 'गाँव', 'village'],                     path: 'land.village_name' },
  { words: ['सर्व्हे', 'सर्वे', 'गट', 'survey', 'gat'],      path: 'land.survey_number' },
  { words: ['क्षेत्र', 'area', 'hectare'],                  path: 'land.total_area_hectares' },
  { words: ['उत्पन्न', 'आय', 'income', 'salary'],          path: 'income.certified_annual_income' },
  { words: ['पत्ता', 'पता', 'address', 'rahanar'],         path: 'identity.address' },
  { words: ['कारण', 'उद्देश', 'purpose', 'reason'],        path: 'purpose' },
  { words: ['नाव', 'नाम', 'name', 'applicant'],           path: 'identity.full_name_latin' },
];

/** "Kandhar, Nanded" -> { taluka: "Kandhar", district: "Nanded" } */
function splitTalukaDistrict(profile) {
  const raw = String(read(profile, 'land.taluka_and_district') || '');
  const [taluka, district] = raw.split(/[,/]/).map((s) => s.trim());
  return { taluka: taluka || '', district: district || '' };
}

function fieldText(field) {
  return [field.label, field.name, field.id, field.placeholder]
    .filter(Boolean).join(' ').toLowerCase();
}

/**
 * @returns {Object<string,string>} ref -> value, omitting anything with no match
 *   or no data. A field we cannot fill is left alone, never filled with a guess.
 */
export function matchFields({ profile, url, fields }) {
  const values = {};
  const derived = splitTalukaDistrict(profile);

  const curated = loadForms().find((f) => url && f.urlPattern && url.includes(f.urlPattern));

  for (const field of fields) {
    // 1. Curated mapping for this form, keyed by the field's id or name.
    if (curated) {
      const dotted = curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name];
      if (dotted) {
        const v = read(profile, dotted);
        if (v != null && v !== 'NULL' && v !== '') { values[field.ref] = String(v); continue; }
      }
    }

    // 2. Keyword fallback.
    const text = fieldText(field);
    if (!text) continue;

    const hit = KEYWORDS.find((k) => k.words.some((w) => text.includes(w)));
    if (!hit) continue;

    const value = hit.derive ? derived[hit.derive] : (hit.path ? read(profile, hit.path) : null);
    if (value != null && value !== 'NULL' && value !== '') values[field.ref] = String(value);
  }

  return values;
}
```

### 3.2 Create `forms/mahaonline-income.json`

```json
{
  "name": "Income Certificate Application (Maharashtra)",
  "urlPattern": "/portal.html",
  "fields": {
    "#applicantName": "identity.full_name_latin",
    "#address": "identity.address",
    "#village": "land.village_name",
    "#income": "income.certified_annual_income",
    "#surveyNo": "land.survey_number",
    "#purpose": "purpose"
  }
}
```

> **Deliberately omitted: `#taluka` and `#district`.** Both are derived by splitting
> `land.taluka_and_district`, and this file's format only holds plain dotted paths — so
> mapping them here would fill both with the same value. Leaving them out lets the
> keyword fallback in `fieldmap.js` derive them correctly from their labels. This is the
> intended division of labour between curated mappings and keyword matching, and the
> 15th test below guards it.

### 3.3 Create `src/fieldmap.test.js`

```js
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
```

### 3.4 Verify

```bash
node src/fieldmap.test.js | grep passed
```
Expected, exactly:
```
15 passed, 0 failed
```

---

## PHASE 4 — Mock portal page

### 4.1 Create `public/portal.html`

A standalone HTML page reproducing the Marathi income-certificate application the team
photographed. Requirements, all mandatory:

- Marathi headings and labels, matching the photographed form
- Fields with these exact ids: `applicantName`, `address`, `village`, `taluka`,
  `district`, `income`, `surveyNo`, `purpose`, `mobile`, `date`
  (`village` matches the real form's *राहणार ___ ता. ___ जि. ___* line and is the field
  the curated mapping's `#village` entry fills)
- Each field has a visible `<label>` carrying the Marathi text
- A checklist section listing the required documents (आधार कार्ड, रहिवासी पुरावा,
  ७/१२ उतारा) as plain static text
- A Submit button that **does nothing except show the text "सादर केले"** (D11 — this
  product never submits)
- Plain CSS, white background, resembling a printed government form
- No JavaScript beyond the submit stub

### 4.2 Verify

```bash
curl -s http://localhost:3000/portal.html | grep -c 'id="applicantName"'
```
Expected: `1`

---

## PHASE 5 — Chrome extension

All files go in `extension/`.

### 5.1 `extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "GovTech Form Assistant",
  "version": "1.0.0",
  "description": "Validates documents and fills government forms from verified records. Never submits.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://localhost:3000/*", "<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }],
  "commands": {
    "open-panel": {
      "suggested_key": { "default": "Ctrl+Shift+F" },
      "description": "Open the form assistant"
    }
  }
}
```

### 5.2 `extension/background.js`

Responsibilities, exactly:
- On `chrome.commands.onCommand` for `open-panel`, send `{type:'TOGGLE_PANEL'}` to the
  active tab.
- Listen for `chrome.runtime.onMessage` of type `API`, with `{method, path, body}`.
  Perform `fetch('http://localhost:3000' + path, …)` and return the parsed JSON.
  **All network calls go through here (D13).**
- Return `{ok:false, error:'service not running'}` when the fetch throws, so the panel
  can show a clear message instead of failing silently.

### 5.3 `extension/content.js`

Responsibilities, exactly:

- Inject a panel into a **shadow DOM** host so portal CSS cannot affect it, and ours
  cannot affect the portal.
- Toggle visibility on `TOGGLE_PANEL`.
- Panel contents:
  - Client dropdown, populated from `GET /api/clients`; disabled entries for clients
    whose `ready` is false
  - Button **Validate documents** → `GET /api/clients/:key/validate?lang=` → render each
    error message as a red line, or one green line when `ok`
  - Button **Fill this form** → see below
  - Button **Voice / type input** → see below
  - Button **Convert / compress** → see below
  - A status line
- **Fill this form:**
  1. Collect every `input:not([type=hidden]):not([type=submit])`, `select`, `textarea`
  2. For each, assign a unique `ref` (`f0`, `f1`, …) stored in a local Map
  3. Determine `label` by, in order: `<label for=id>` text; closest ancestor `<label>`
     text; the `aria-label`; the preceding sibling text node
  4. `POST /api/fill` with `{client, url: location.href, fields}`
  5. For each returned `ref`, set `element.value` and dispatch `new Event('input',
     {bubbles:true})` and `new Event('change', {bubbles:true})` so framework-bound
     fields update
  6. Briefly outline filled fields in green; report `matched/total` in the status line
  7. **Never touch a field not present in the response.**
- **Voice / type input (D6, D7):**
  1. Remember the last focused form element before the panel opened
  2. Show a textarea and a **Record** button side by side — typing is a first-class path,
     not a fallback (D7)
  3. Record with `MediaRecorder`, stop on a second press, base64 the blob,
     `POST /api/stt` with the panel language
  4. Put the transcript **into the textarea** — never straight into the page
  5. An **Insert** button writes the textarea contents into the remembered element and
     dispatches `input`/`change`
- **Convert / compress (D9, D10):**
  1. File picker accepting images
  2. Target format select: JPEG / PNG / WEBP / PDF
  3. Max size input in KB, default 200
  4. For image targets: draw to `<canvas>`, export with `toBlob(type, quality)`, stepping
     quality down from 0.92 by 0.07 until under the byte budget or quality reaches 0.3,
     then halving pixel dimensions and repeating up to 3 times
  5. For PDF: `POST /api/to-pdf`
  6. Trigger a download of the result and show the final size

### 5.4 Verify

Load unpacked from `chrome://extensions` with Developer Mode on, then on
`http://localhost:3000/portal.html`:

1. `Ctrl+Shift+F` opens the panel
2. The client dropdown lists clients from `MASTER/`
3. **Fill this form** populates the Marathi form and reports e.g. `7/9 fields filled`
4. **Validate documents** shows either a green line or specific errors
5. Nothing is ever submitted

---

## PHASE 6 — Panel multilingual + date auto-fill

Two defects found after Phase 5. Both are specification errors, not execution errors.

**Defect A.** The panel's own text is hard-coded English. `/api/strings` exists for
exactly this, but 5.3 named the buttons in English. The PS opens with "Multilingual"; an
English-only panel is a visible miss.

**Defect B.** `दिनांक` (date) fills nothing. Today's date is always correct for it.

### 6.1 Add panel keys to all three catalogs

Add these to `src/i18n/en.json`, `src/i18n/hi.json` and `src/i18n/mr.json`.
`src/i18n.test.js` enforces key parity, so **all three must get all fifteen** or that
suite fails.

`en.json`:
```json
  "panel_title": "Form Assistant",
  "panel_client": "Client",
  "panel_validate": "Validate documents",
  "panel_fill": "Fill this form",
  "panel_voice": "Voice / type input",
  "panel_convert": "Convert / compress",
  "panel_incomplete": "(incomplete)",
  "panel_no_service": "Local service is not running.",
  "panel_no_client": "Select a client first.",
  "panel_filled": "{n} of {total} fields filled",
  "panel_record": "Record",
  "panel_stop": "Stop",
  "panel_insert": "Insert",
  "panel_format": "Format",
  "panel_maxsize": "Max size (KB)",
```

`hi.json`:
```json
  "panel_title": "फॉर्म सहायक",
  "panel_client": "ग्राहक",
  "panel_validate": "दस्तावेज़ जाँचें",
  "panel_fill": "यह फॉर्म भरें",
  "panel_voice": "बोलें या टाइप करें",
  "panel_convert": "बदलें / छोटा करें",
  "panel_incomplete": "(अधूरा)",
  "panel_no_service": "लोकल सेवा नहीं चल रही है।",
  "panel_no_client": "पहले ग्राहक चुनें।",
  "panel_filled": "{total} में से {n} फ़ील्ड भरे गए",
  "panel_record": "रिकॉर्ड करें",
  "panel_stop": "रोकें",
  "panel_insert": "डालें",
  "panel_format": "प्रारूप",
  "panel_maxsize": "अधिकतम आकार (KB)",
```

`mr.json`:
```json
  "panel_title": "फॉर्म साहाय्यक",
  "panel_client": "ग्राहक",
  "panel_validate": "कागदपत्रे तपासा",
  "panel_fill": "हा फॉर्म भरा",
  "panel_voice": "बोला किंवा टाइप करा",
  "panel_convert": "रूपांतर / आकार कमी करा",
  "panel_incomplete": "(अपूर्ण)",
  "panel_no_service": "लोकल सेवा चालू नाही.",
  "panel_no_client": "आधी ग्राहक निवडा.",
  "panel_filled": "{total} पैकी {n} फील्ड भरले",
  "panel_record": "रेकॉर्ड करा",
  "panel_stop": "थांबा",
  "panel_insert": "टाका",
  "panel_format": "स्वरूप",
  "panel_maxsize": "कमाल आकार (KB)",
```

### 6.2 Serve the panel keys

In `src/web.js`, in the `/api/strings` route, extend the `keys` array with the fifteen
`panel_*` keys above. Change nothing else in that route.

### 6.3 Date auto-fill

In `src/fieldmap.js`:

1. In `splitTalukaDistrict`, also return today's date. Rename nothing; just add the
   field:
```js
  return {
    taluka: taluka || '',
    district: district || '',
    today: new Date().toISOString().slice(0, 10),
  };
```

2. Append this entry to the **end** of the `KEYWORDS` array. It must be last: "Date of
   Birth" contains "date", and the `birth` entry at index 0 must keep winning.
```js
  { words: ['दिनांक', 'दिनाक', 'date', 'tarikh'], derive: 'today' },
```

### 6.4 Add two tests to `src/fieldmap.test.js`

Insert before the final `console.log` summary line:

```js
console.log('\nDate auto-fill');
const today = new Date().toISOString().slice(0, 10);
v = matchFields({ profile, url: '', fields: [f('a', 'दिनांक'), f('b', 'Date of Birth')] });
check('date field gets today', v.a === today);
check('date keyword does NOT steal Date of Birth', v.b === '1982-07-14');
```

Expected count after this: **17 passed, 0 failed**.

### 6.5 Panel uses the catalog

In `extension/content.js`:

1. Add a language `<select>` at the top of the panel with options `English`, `हिंदी`,
   `मराठी` (values `en`, `hi`, `mr`). Persist the choice with
   `chrome.storage.local` under key `lang`; default `en`.
2. On panel open, and whenever the language changes, `GET /api/strings?lang=<lang>` and
   render every panel label from the response. No user-facing string in the panel may
   remain hard-coded.
3. `panel_filled` carries `{n}` and `{total}` placeholders — substitute them, do not
   rebuild the sentence in JavaScript.
4. Pass the same `lang` to `/api/clients/:key/validate?lang=` and to `/api/stt`.

### 6.6 Verify

```bash
node src/i18n.test.js | grep passed
node src/fieldmap.test.js | grep passed
node --check extension/content.js && echo "content ok"
```
Expected, exactly:
```
19 passed, 0 failed
17 passed, 0 failed
content ok
```

Then with `npm start` running:
```bash
curl -s "http://localhost:3000/api/strings?lang=mr" | grep -c panel_fill
```
Expected: `1`

---

## PHASE 7 — Finish the panel translation

Phase 6 supplied 15 keys, but step 6.5 required that *no* panel string stay hard-coded.
Six remained. This is a specification error in Phase 6, not an execution error.

Format names in the dropdown (JPEG, PNG, WEBP, PDF) stay as they are — they are proper
nouns, not prose.

### 7.1 Add six more keys to all three catalogs

`en.json`:
```json
  "panel_click_field": "Click a form field first.",
  "panel_inserted": "Inserted.",
  "panel_choose_image": "Choose an image",
  "panel_pdf_failed": "PDF conversion failed.",
  "panel_fill_failed": "Could not fill the form.",
  "panel_done_kb": "Done — {n} KB",
```

`hi.json`:
```json
  "panel_click_field": "पहले कोई फ़ील्ड चुनें।",
  "panel_inserted": "डाल दिया गया।",
  "panel_choose_image": "एक छवि चुनें",
  "panel_pdf_failed": "PDF रूपांतरण विफल रहा।",
  "panel_fill_failed": "फॉर्म नहीं भरा जा सका।",
  "panel_done_kb": "पूर्ण — {n} KB",
```

`mr.json`:
```json
  "panel_click_field": "आधी एक फील्ड निवडा.",
  "panel_inserted": "टाकले.",
  "panel_choose_image": "एक प्रतिमा निवडा",
  "panel_pdf_failed": "PDF रूपांतर अयशस्वी झाले.",
  "panel_fill_failed": "फॉर्म भरता आला नाही.",
  "panel_done_kb": "पूर्ण — {n} KB",
```

### 7.2 Serve them

Add the six keys to the `keys` array in `/api/strings` in `src/web.js`. Change nothing
else in that route.

### 7.3 Use them in `extension/content.js`

Replace these five hard-coded literals with the corresponding catalog lookups, and the
"Done: N KB" message with `panel_done_kb` (substituting `{n}`):

| Current literal | Key |
|---|---|
| `Click a form field first` | `panel_click_field` |
| `Inserted` | `panel_inserted` |
| `Choose an image` | `panel_choose_image` |
| `PDF conversion failed` | `panel_pdf_failed` |
| `fill failed` | `panel_fill_failed` |

Change nothing else in that file. The fill, voice and convert logic stays as it is.

### 7.4 Verify

```bash
node src/i18n.test.js | grep passed
node --check extension/content.js && echo "content ok"
grep -cE "'(Click a form field first|Inserted|Choose an image|PDF conversion failed|fill failed)'" extension/content.js
```
Expected, exactly:
```
19 passed, 0 failed
content ok
0
```

> **Why 19 and not a larger number.** `src/i18n.test.js` iterates over *languages*, not
> over keys — roughly three checks per language plus registration, interpolation and
> fallback. Its count is therefore fixed no matter how many strings the catalogs hold.
> Adding keys cannot raise it. What the suite proves here is **parity**: zero missing,
> zero extra, zero untranslated, across all three files.

---

## PHASE 8 — Two prompt defects found on real Aadhaar cards

Found while testing three real photographed Aadhaar cards through
`qwen3-vl:4b-instruct`. Both are prompt defects, not code defects.

**Defect A — field labels captured as data.** On a Gujarat card the model returned:
```
"address": "Address: House Name - <redacted>, Street No - 5, ..."
            ^^^^^^^^ the printed label, swallowed into the value
```
On a filled form that renders as *"Address: Address: House Name…"*.

**Defect B — Indic scripts transliterated into each other.** A Punjabi card printing
**<Gurmukhi name>** (Gurmukhi) returned `<Devanagari name>` (Devanagari). The prompt already says to
transcribe exactly as printed, but the model treats Indic scripts as interchangeable.
Harmless for matching, which uses the Latin field — but if `full_name` is ever shown back
to the user as "the name on your document", it will not match their card.

> **This phase is the one permitted exception to the out-of-scope rule on
> `src/extractor.js` prompts.** Change only what 8.1 and 8.2 specify.

### 8.1 Add two constraints to the system prompt

In `src/extractor.js`, in `SYSTEM_PROMPT`, append after the existing constraint 6:

```text
7. VALUES ONLY: Never include a field's printed label in its value. If the document shows "Address: 12 Main Street", output "12 Main Street", not "Address: 12 Main Street". The same applies to every field.
8. SCRIPT FIDELITY: Transcribe in the exact script printed on the document. Devanagari, Gurmukhi, Gujarati, Tamil and other Indic scripts are NOT interchangeable. Never convert between them. Only the *_latin fields may be transliterated.
```

### 8.2 Tighten the address field description

In the `identity` schema in `src/extractor.js`, find:
```
  "address": "String - The complete printed address, combining all lines",
```
Replace with:
```
  "address": "String - The complete printed address, combining all lines. Do NOT include the word 'Address' or any other field label.",
```

### 8.3 Verify against a real card

Requires Ollama running with `qwen3-vl:4b-instruct`, and the sample at
`C:/Users/gurav/Downloads/Adhhar eg/1.jpeg`.

```bash
node src/extract.cli.js identity "C:/Users/gurav/Downloads/Adhhar eg/1.jpeg"
```

Both must hold in the returned JSON:
1. `address` does **not** begin with `Address:` (any case)
2. `pin_code` is still `<pin>` and `id_number_last_four` is still `<last4>` — the fix must
   not have degraded extraction

If `address` still starts with the label, STOP and report. Do not edit the prompt further
to chase it; a second prompt change is a decision, not an execution step.

> Model output varies between runs. If `address` is clean but another field differs
> slightly from the earlier run, that is acceptable — report it, do not act on it.

### 8.5 Outcome — one fix worked, one did not

**Defect A (field labels): FIXED.** The Gujarat card now returns
`"House Name - <redacted>, Street No - 5, …"` with no `Address:` prefix, and `pin_code`
and `id_number_last_four` are unchanged.

**Defect B (script fidelity): NOT FIXED — accepted as a known limitation.**
Re-running the Punjabi card after the change still returns `<Devanagari name>` (Devanagari) where
the card prints `<Gurmukhi name>` (Gurmukhi). Constraint 8 had no measurable effect.

**Do not attempt further prompt engineering on this.** The decision is made: accept it.
Reasoning:
- `full_name_latin` — used for cross-document matching **and** for the filled form — was
  correct on every card tested. Nothing downstream is affected.
- `full_name` is only shown back to the user in error messages. A Punjabi speaker would
  see their name in Devanagari: recognisable, mildly wrong, not harmful.
- The model appears to normalise Indic scripts toward Devanagari regardless of
  instruction. More prompt wording is unlikely to shift that, and the time is better
  spent on the untested 7/12 land record.

**If a judge asks:** say it plainly — the model normalises regional scripts toward
Devanagari, it does not affect the submitted form because that uses the Latin field, and
the review step shows the operator every value before anything is generated.

### 8.6 Known accuracy limit, measured

On a low-resolution Gujarat card the model returned `Surname Firstname Father**x**name` for a
card printing `Surname Firstname Fathername` — one inserted character in a name bound for a
government form.

**The fuzzy matcher scores that pair at 0.92 and passes it**, which is deliberate: the
0.75 threshold exists so transliteration variance between documents does not falsely
reject a legitimate applicant. The consequence is that this class of error passes every
automated check.

**The only guard is B9, the human review step.** This is the concrete justification for
marking it non-cuttable — better evidence than the reasoning originally written for it.

### 8.4 Confirm no regressions

```bash
npm test
node src/fieldmap.test.js | grep passed
```
Expected: 21, 28, 16, 19, 13 all with 0 failed; and `17 passed, 0 failed`.

---

## Out of scope — do not build

- Electron or any desktop wrapper (D1)
- Any npm or pip install (D2)
- PDF → text, PDF → image (D9)
- Autofill without a keypress
- Touching `src/whatsapp.js`, `src/rulebook.js`, `src/extractor.js` prompts or schemas
- Changing `src/web.js`'s existing routes or `public/index.html` (D12). Adding the
  static-file middleware in `src/server.js` per step 2.4a is explicitly allowed and
  required — it changes no existing route.
- Any form of submit, anywhere (D11)

## Stop-and-report format

```
PHASE: <number>  STEP: <number>
COMMAND: <what you ran>
EXPECTED: <from this plan>
ACTUAL: <what happened>
```
