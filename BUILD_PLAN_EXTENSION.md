# Build Plan — CSC Operator Assistant (extension + local service)

**Audience:** builder subagents. **Decisions: all made. None delegated.**
Read `EXECUTION_PLAN.md` Section 0 first — the same execution rules apply verbatim.

---

## 00. User requirements — the source of truth (added 2026-11-14)

These are the user's own requirements, quoted. **They override any decision below that
conflicts with them.** They were stated on 2026-11-13 but never written into this plan,
because the planner learned from transcripts truncated at 600 characters. Every phase must
be checked against this section before it is written.

| # | User's words | What it requires |
|---|---|---|
| R1 | *"once he uploads it, say in a slot where its to be uploaded, on the form… this automated thing must capture that upload, and automatically scan it, verify it, update the user if its bad"* (13:24) · *"seamlessness is also necessary than an extra step"* (13:27) | **Upload capture:** a file picked in the portal's upload slot is read and validated automatically; problems are shown on the spot. This is the PS's "automated pre-submission". |
| R2 | *"it should be seamless, like invoked with a keybind, then it functions, like you click on a typing field, and type / speak your name… and it gets filled in the designated field"* (15:25) | Voice / chat into the **clicked field**, invoked by a keybind. |
| R3 | *"the ability to convert one format like pdf to text and jpeg to png and vice versa… these websites force users to restrict to a particular file format"* (16:09) | Format conversion **including PDF → text and PDF ↔ image**, both directions. **Supersedes D9.** |
| R4 | *"Needs an extension - Voice & chat to form integration"* (16:09) | Voice and chat fill form fields from inside the browser. |
| R5 | *"Manual form integration - train workflow around specific checked and saved forms… accuracy / reliability is the key"* (16:09) | Curated mappings of **real** government forms (D8). |
| R6 | *"Image compression feature… many forms have upload space limit"* (16:09) | Compress to a portal's size limit. |
| R7 | *"a keybind to invoke compression feature, keybind to change formats, keybind to voice / chat, and so on"* · *"a gemini like pop up from under the screen when one feature is invoked"* — not *"a screen blocking window that never leaves"* (2026-11-14) | **One keybind per feature.** Each opens a small pop-up rising from the bottom of the screen, does one job, and closes itself. **Supersedes the single panel and D15.** |
| R8 | *"the fundamental idea of validation is not to auto fill by reading / parsing, its to validate the doc"* (2026-11-14), consistent with BUILD_SPEC §5.3 | Validation judges documents (would they be rejected?). It is independent of filling and never a data source for it. |

| R9 | *"OCR never — nor in PS and never in plan — planned to extract info, it was a misunderstanding… left built as it cost nothing to let it exist as an additional feature, but it was never meant to exist"* · *"voice and chat is a separate feature and OCR is a separate feature"* (2026-11-14) | **The product is two independent features:** (1) **voice / chat form filling** — the primary way to fill, works with no documents and no client; (2) **automated pre-submission OCR validation** — documents checked when uploaded so the portal does not reject them. **Filling from documents (Ctrl+Shift+F) is an extra, not the product.** Never present or plan it as the core. |

**D2 and D9 superseded for PDF (2026-11-14):** D9 cut PDF→text / PDF→image citing failed
installs, but the user's standing rule (2026-11-13) was to *retry failed installs in the
background without asking*. `pdfjs-dist` is therefore installed (retried until success) and
R3 is built in full.

**Not yet built (as of 2026-11-14):** R1, R3 (PDF parts), R7, and R2/R4 in the keybind +
pop-up form. Also unmet from below: D5 (keybind fills), the PS table's "auto-validate" and
"directory watch", ADR-8's guessed-name marking.

---

## 000. Phase map — what each phase really is

| Phase | Really | Repairs / builds | Why it was needed |
|---|---|---|---|
| Phases 1–8 | Original plan | Enrolment, API, field matching, mock portal, extension, panel i18n, panel translation, prompt fixes | The planned build. |
| Phase 9 | Fix | Extraction (ADR-1) + rulebook §5.1 land checks | 7/12 was never tested and read nothing; operator-typed 7/12 numbers (user decision). |
| Phase 10 | Fix to Phase 3/4 | Real Aaple Sarkar EWS form replaces the mock (R5) | The mock portal was not the real form. |
| Phase 11 | User decision | Incomplete clients can be filled | The user decided incomplete clients must be fillable. |
| Phase 12 | Fix to Phase 5 | Panel messaging after Validate | Validate showed a blank box; missing documents are now listed. |
| Phase 13 | Fix | Rulebook §5.1 check 6 (PIN, survey number) | The check was specified but never built. |
| Phase 14 (Parts A, B) | Build | §00 R1–R8 + D5, auto-validate, MASTER watch, ADR-8 | The user's requirements in §00 were not yet built. |
| A12 | Build | R8 / user #124 | Validation now judges every document present. |
| A13 | Build | R5 | Set-up (curated) forms only, no general guessing. |

Rule: every new phase must be checked against §00 first and say which phase it repairs or which R it builds.

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

## PHASE 9 — 7/12 land records: two-pass reading, operator-typed numbers, land rules

> **This phase is a permitted exception** to the out-of-scope rules on `src/extractor.js`
> and `src/rulebook.js`. Change only what 9.1–9.7 specify.

### Findings this phase acts on (measured 2026-11-13)

Test image: `C:/Users/gurav/Downloads/712-sample/satbara-SAMPLE-edited.png`, a public
Mahabhulekh 7/12 whose blurred fields were filled with **invented** data and marked
**SAMPLE / नमुना — NOT A REAL RECORD**. **Never remove or crop out that watermark, not
even for a test.**

| Test | Result |
|---|---|
| Current single-prompt extraction, full page | **every field NULL**, in ~4s |
| Same, no watermark | identical, so the watermark is not the cause |
| Plain question, full page | taluka, district and both owners correct |
| Context 4096 vs 8192 | identical; the page uses 1,803 tokens. Not a context limit |
| **Two passes (transcribe, then structure)** | village वडगाव, taluka हवेली, district पुणे, both owners correct in Devanagari and Latin |
| Devanagari digits, any approach, incl. 2× resolution | **wrong and confident**: `४५/२`→`842`, `०.८१.००`→`0.62.00`, `२३-०७-२०२४`→`23-09-2023`. ४ is read as ८ |

**Decisions (user, 2026-11-13):**
- 7/12s are read in two passes.
- **Survey number, area and print date from a 7/12 are never taken from the model.** They
  are blanked and listed in `needs_operator`. The extension leaves those form fields empty
  and outlines them amber; the operator types them from the paper.
- The rulebook gains the land-area check the spec always required (< 5 acres = 2.0234 ha)
  and stops silently passing an unreadable land date. Operator-entry fields are exempt from
  both and raise a notice instead of an error.

The mock path (`USE_MOCK=true`, fixtures) is unchanged and keeps its numbers.

### 9.1 `src/extractor.js` — two-pass land reading and operator fields

**(a)** Immediately after the closing `};` of `export const SCHEMAS = { ... };`, insert:

```js
// Phase 9: a 7/12 is read in two passes. Measured on a SAMPLE 7/12: the strict JSON prompt
// returned NULL for every field on a full page, while a plain transcription prompt read the
// village, taluka, district and every owner correctly. Pass 1 transcribes the image as plain
// text; pass 2 structures that text with the normal system prompt and schema, with no image.
export const LAND_TRANSCRIBE_PROMPT = `Transcribe this land record (7/12 extract) as plain text. Copy text exactly as printed, in the script printed. Keep Devanagari digits as printed. Output these lines, one per item:
गाव (village): ...
तालुका (taluka): ...
जिल्हा (district): ...
गट क्रमांक / survey number: ...
Owner table rows (one line each): खाते क्र | भोगवटादाराचे नाव | क्षेत्र | आकार
Total area (एकूण क्षेत्र): ...
Every date printed anywhere on the page: ...
Write NULL for anything you cannot read.`;

const LAND_SCHEMA_INTRO = 'Analyze the attached agricultural land record (7/12 extract). This document may contain complex tables and regional languages. ';

export function landStructurePrompt(transcript) {
  return `The following is a plain-text transcription of a land record (7/12 extract). Use ONLY this text as the source.\n\n---\n${transcript}\n---\n\n${SCHEMAS.land.replace(LAND_SCHEMA_INTRO, '')}`;
}

// Phase 9: the model misreads Devanagari digits (४ read as ८; ४५/२ returned as 842),
// confidently and even at 2x resolution. Numbers on a 7/12 are therefore never taken from
// the model: they are blanked and listed in needs_operator, and the operator types them
// from the paper extract. A wrong survey number on a government form is the exact silent
// failure this product exists to prevent.
export const LAND_OPERATOR_FIELDS = ['survey_number', 'total_area_hectares', 'record_print_date'];

export function applyOperatorFields(land) {
  const out = { ...land };
  for (const k of LAND_OPERATOR_FIELDS) out[k] = null;
  out.needs_operator = [...LAND_OPERATOR_FIELDS];
  return out;
}
```

**(b)** Immediately after the closing `}` of `async function callOllama(...)`, insert:

```js
async function ollamaGenerate(body, extraOptions = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      stream: false,
      options: { temperature: 0, ...extraOptions },
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response;
}

async function callOllamaLand(imageBuffer) {
  // num_predict caps pass 1: on one test the model looped on a single line 68 times.
  const transcript = await ollamaGenerate(
    { prompt: LAND_TRANSCRIBE_PROMPT, images: [imageBuffer.toString('base64')] },
    { num_predict: 600 },
  );
  return ollamaGenerate({ system: SYSTEM_PROMPT, prompt: landStructurePrompt(transcript) });
}
```

**(c)** In `extractDocument`, find:
```js
      const raw = await callOllama(imageBuffer, docType);
      return maskIdNumbers(sanitiseJson(raw));
```
Replace with:
```js
      const raw = docType === 'land'
        ? await callOllamaLand(imageBuffer)
        : await callOllama(imageBuffer, docType);
      const data = maskIdNumbers(sanitiseJson(raw));
      return docType === 'land' ? applyOperatorFields(data) : data;
```

Do not change `SYSTEM_PROMPT`, `SCHEMAS`, `callOllama`, or the mock branch.

### 9.2 `src/rulebook.js` — digits, area, land date, notices

**(a)** Find:
```js
const LAND_RECORD_MAX_AGE_MONTHS = 6;
```
Replace with:
```js
const LAND_RECORD_MAX_AGE_MONTHS = 6;
const LAND_AREA_MAX_HECTARES = 2.0234;   // 5 acres, central EWS criterion

/** "४५/२" -> "45/2". Devanagari digits are U+0966..U+096F. */
export function toAsciiDigits(s) {
  return String(s).replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

/**
 * Land area in hectares, or null if unreadable.
 * Accepts plain hectares ("1.21") and the 7/12 H.R.SqM form ("0.81.00" = 0 ha 81 are 0 m²).
 */
export function parseHectares(v) {
  if (v == null || v === 'NULL') return null;
  const s = toAsciiDigits(v).trim();
  const hrs = s.match(/^(\d+)\.(\d{1,2})\.(\d{1,2})$/);
  if (hrs) return Number(hrs[1]) + Number(hrs[2]) / 100 + Number(hrs[3]) / 10000;
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
```

**(b)** In `monthsSince`, find:
```js
  const d = new Date(dateStr);
```
Replace with:
```js
  const d = new Date(toAsciiDigits(dateStr));
```

**(c)** Replace **both** occurrences of `{ ok: false, errors, missing }` with
`{ ok: false, errors, missing, notices: [] }`. There are exactly two (missing documents,
blurry identity). If you find a different number, STOP.

**(d)** Find:
```js
  // --- recency ---
```
Replace with:
```js
  // --- Phase 9: fields the operator types from the paper 7/12 ---
  // Exempt from the unreadable checks below; the operator is told instead.
  const notices = [];
  const operatorFields = Array.isArray(land.needs_operator) ? land.needs_operator : [];
  if (operatorFields.length) notices.push({ key: 'land_operator_entry', params: {} });

  // --- recency ---
```

**(e)** Find:
```js
  const landAge = monthsSince(land.record_print_date, now);
  if (landAge !== null && landAge > LAND_RECORD_MAX_AGE_MONTHS) {
```
Replace with:
```js
  const landAge = monthsSince(land.record_print_date, now);
  if (landAge === null) {
    if (!operatorFields.includes('record_print_date')) {
      errors.push({ key: 'land_date_unreadable', params: {} });
    }
  } else if (landAge > LAND_RECORD_MAX_AGE_MONTHS) {
```

**(f)** Find:
```js
  // --- field present on no document ---
```
Replace with:
```js
  // --- land size: central EWS criterion, < 5 acres ---
  const hectares = parseHectares(land.total_area_hectares);
  if (hectares === null) {
    if (!operatorFields.includes('total_area_hectares')) {
      errors.push({ key: 'land_area_unreadable', params: {} });
    }
  } else if (hectares >= LAND_AREA_MAX_HECTARES) {
    errors.push({ key: 'land_too_large', params: { n: hectares.toFixed(2) } });
  }

  // --- field present on no document ---
```

**(g)** Find:
```js
  return { ok: errors.length === 0 && missing.length === 0, errors, missing };
```
Replace with:
```js
  return { ok: errors.length === 0 && missing.length === 0, errors, missing, notices };
```

### 9.3 `src/rulebook.test.js` — 10 new checks

Find:
```js
import { validateEWS, namesMatch, monthsSince } from './rulebook.js';
```
Replace with:
```js
import { validateEWS, namesMatch, monthsSince, parseHectares, toAsciiDigits } from './rulebook.js';
```

Find:
```js
console.log(`\n${pass} passed, ${fail} failed\n`);
```
Insert immediately **before** it:
```js
console.log('\nLand checks (Phase 9)');
check('Devanagari digits converted', toAsciiDigits('४५/२') === '45/2');
check('7/12 H.R.SqM area parsed', Math.abs(parseHectares('०.८१.००') - 0.81) < 1e-9);
check('plain hectares parsed', parseHectares('1.21') === 1.21);
check('NULL area is null', parseHectares('NULL') === null);

const base = { identity: load('identity'), income: load('income'), purpose: 'School admission' };
const big = validateEWS({ ...base, land: { ...load('land'), total_area_hectares: '2.50' } }, NOW);
check('land of 2.50 ha rejected', big.errors.some((e) => e.key === 'land_too_large'));
const noArea = validateEWS({ ...base, land: { ...load('land'), total_area_hectares: 'NULL' } }, NOW);
check('unreadable area is an error', noArea.errors.some((e) => e.key === 'land_area_unreadable'));
const noDate = validateEWS({ ...base, land: { ...load('land'), record_print_date: 'NULL' } }, NOW);
check('unreadable land date is an error', noDate.errors.some((e) => e.key === 'land_date_unreadable'));

const opLand = {
  ...load('land'), survey_number: null, total_area_hectares: null, record_print_date: null,
  needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'],
};
const op = validateEWS({ ...base, land: opLand }, NOW);
check('operator fields do not fail validation', op.ok === true);
check('operator notice raised', op.notices.some((e) => e.key === 'land_operator_entry'));
check('clean profile has no notices', good.notices.length === 0);
```

### 9.4 i18n — 4 new keys in all three catalogs

In each file, insert the four lines **immediately after** the existing `"land_stale"` line.
The Hindi and Marathi strings are written by the planner; **the team must proofread them
before the demo** (ADR-7).

`src/i18n/en.json`:
```json
  "land_too_large": "Problem found: the 7/12 extract shows {n} hectares of land. EWS requires less than 5 acres (2.02 hectares).",
  "land_area_unreadable": "I could not read the land area on the 7/12 extract. Please resend it.",
  "land_date_unreadable": "I could not read the date on the 7/12 extract. Please resend it.",
  "land_operator_entry": "Type the survey number, area and date from the paper 7/12 — the AI does not read these numbers reliably. Area must be under 2.02 hectares and the extract under 6 months old.",
```

`src/i18n/hi.json`:
```json
  "land_too_large": "समस्या मिली: ७/१२ अभिलेख में {n} हेक्टेयर ज़मीन दिखाई गई है। EWS के लिए ५ एकड़ (२.०२ हेक्टेयर) से कम ज़मीन होनी चाहिए।",
  "land_area_unreadable": "७/१२ अभिलेख पर ज़मीन का क्षेत्रफल नहीं पढ़ा जा सका। कृपया दोबारा भेजें।",
  "land_date_unreadable": "७/१२ अभिलेख पर तारीख नहीं पढ़ी जा सकी। कृपया दोबारा भेजें।",
  "land_operator_entry": "सर्वे नंबर, क्षेत्रफल और तारीख कागज़ी ७/१२ से स्वयं भरें — AI इन अंकों को भरोसेमंद ढंग से नहीं पढ़ता। क्षेत्रफल २.०२ हेक्टेयर से कम और अभिलेख ६ महीने से नया होना चाहिए।",
```

`src/i18n/mr.json`:
```json
  "land_too_large": "अडचण आढळली: ७/१२ उताऱ्यावर {n} हेक्टर जमीन दिसते. EWS साठी ५ एकरपेक्षा (२.०२ हेक्टर) कमी जमीन असणे आवश्यक आहे.",
  "land_area_unreadable": "७/१२ उताऱ्यावरील क्षेत्र वाचता आले नाही. कृपया पुन्हा पाठवा.",
  "land_date_unreadable": "७/१२ उताऱ्यावरील दिनांक वाचता आला नाही. कृपया पुन्हा पाठवा.",
  "land_operator_entry": "सर्व्हे नंबर, क्षेत्र आणि दिनांक कागदी ७/१२ उताऱ्यावरून स्वतः भरा — AI हे अंक विश्वासार्हपणे वाचत नाही. क्षेत्र २.०२ हेक्टरपेक्षा कमी आणि उतारा ६ महिन्यांपेक्षा नवीन असावा.",
```

### 9.5 `src/fieldmap.js` — which fields the operator types

Append at the end of the file:
```js
/**
 * Phase 9: refs of form fields whose value the operator must type from the paper document
 * (profile.land.needs_operator). The extension leaves these empty and outlines them amber.
 * Uses the same resolution order as matchFields: curated mapping first, then keywords.
 */
export function operatorRefs({ profile, url, fields }) {
  const pending = new Set((profile?.land?.needs_operator || []).map((k) => `land.${k}`));
  if (!pending.size) return [];

  const curated = loadForms().find((f) => url && f.urlPattern && url.includes(f.urlPattern));
  const refs = [];

  for (const field of fields) {
    let dotted = curated ? (curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name]) : undefined;
    if (!dotted) {
      const text = fieldText(field);
      const hit = text ? KEYWORDS.find((k) => k.words.some((w) => text.includes(w))) : null;
      dotted = hit ? hit.path : null;
    }
    if (dotted && pending.has(dotted)) refs.push(field.ref);
  }
  return refs;
}
```
Do not change `matchFields`.

### 9.6 `src/fieldmap.test.js` — 2 new checks

Find:
```js
import { matchFields } from './fieldmap.js';
```
Replace with:
```js
import { matchFields, operatorRefs } from './fieldmap.js';
```

Find:
```js
console.log(`\n${pass} passed, ${fail} failed\n`);
```
Insert immediately **before** it:
```js
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
```

### 9.7 `src/web.js` and `extension/content.js` — surface it in the panel

**`src/web.js`**

(a) Find `import { matchFields } from './fieldmap.js';` → replace with
`import { matchFields, operatorRefs } from './fieldmap.js';`

(b) In the `/api/strings` route, find:
```js
    'panel_click_field', 'panel_inserted', 'panel_choose_image', 'panel_pdf_failed', 'panel_fill_failed', 'panel_done_kb',
  ];
```
Replace with:
```js
    'panel_click_field', 'panel_inserted', 'panel_choose_image', 'panel_pdf_failed', 'panel_fill_failed', 'panel_done_kb',
    'land_operator_entry',
  ];
```

(c) In the `/api/clients/:key/validate` route, find:
```js
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
```
Replace with:
```js
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
    notices: (result.notices || []).map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
```
If this block matches more than once, STOP.

(d) Find:
```js
  res.json({ values, matched: Object.keys(values).length, total: fields.length });
```
Replace with:
```js
  res.json({
    values,
    operator: operatorRefs({ profile, url, fields }),
    matched: Object.keys(values).length,
    total: fields.length,
  });
```

Do not touch any other route in `src/web.js` (D12).

**`extension/content.js`**

(e) In the validate handler, find:
```js
      for (const e of r.errors || []) {
        const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message; out.appendChild(d);
      }
    }
    status('');
```
Replace with:
```js
      for (const e of r.errors || []) {
        const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message; out.appendChild(d);
      }
    }
    // Phase 9: fields the operator types from paper. Amber, not red: not a failure.
    for (const n of r.notices || []) {
      const d = document.createElement('div'); d.style.color = '#a15c00'; d.textContent = n.message; out.appendChild(d);
    }
    status('');
```

(f) In the fill handler, find:
```js
      el.style.outline = '2px solid #0a7d2c';
    }
```
Replace with:
```js
      el.style.outline = '2px solid #0a7d2c';
    }
    // Phase 9: never filled from the model. Left empty, outlined amber, operator types it.
    for (const ref of r.operator || []) {
      const el = refs.get(ref);
      if (!el) continue;
      el.value = '';
      el.style.outline = '3px solid #e69500';
      el.title = T('land_operator_entry');
    }
```

### 9.8 Verify

```bash
npm test
node src/fieldmap.test.js | grep passed
node --check extension/content.js && echo "content ok"
```
Expected, in order: `31 passed, 0 failed`, `28 passed, 0 failed`, `16 passed, 0 failed`,
`19 passed, 0 failed`, `13 passed, 0 failed`; then `19 passed, 0 failed`; then `content ok`.

Then the real model (Ollama running with `qwen3-vl:4b-instruct`):
```bash
node src/extract.cli.js land "C:/Users/gurav/Downloads/712-sample/satbara-SAMPLE-edited.png"
```
All of these must hold:
1. `owner_names_latin` contains `Ramesh Shankar Patil` and `Sunita Ramesh Patil`
2. `survey_number`, `total_area_hectares` and `record_print_date` are all `null`
3. `needs_operator` is `["survey_number","total_area_hectares","record_print_date"]`

Also report `village_name` and `taluka_and_district` as returned. Expected `वडगाव` and
something containing `हवेली` and `पुणे`; model output varies between runs. If 1–3 hold
but these differ, **report it, do not act on it.** If 1, 2 or 3 fails, STOP and report.
Do not edit the prompts to chase a result.

Use only the watermarked image above. Do not make, crop or edit any image.

---

## PHASE 10 — Curate the real Aaple Sarkar EWS form

> **Why this phase exists.** Phases 3–4 curated a mock page copied from a photo, not a real
> government form, and its form (income certificate application) did not match the EWS
> rulebook. This phase targets the **real** form: Aaple Sarkar / MahaOnline
> **"EWS 10% Self-Declaration"**, URL path `/EWSSelftDeclaration/SelfDeclarationApplication`
> on `rd.mahaonline.gov.in` (the misspelling "Selft" is the portal's own).
>
> Field ids and option lists below were read from pages the team saved while logged in
> (`C:\Users\gurav\Downloads\EWS FORM EG\Revenue Department.html 2 e.html` and `2 m.html`).
> **Those files contain a real person's details. Never copy anything from them into the
> repo beyond what this plan specifies. Do not open the real portal.**

### Facts from the real page that drive the design

| Fact | Consequence |
|---|---|
| Dropdown option **values** differ per language for gender (GUIDs), are codes for districts (521 = Pune = पुणे) | Pick options by **visible text**, never by value |
| Taluka and village lists load by AJAX only after the district (then taluka) **changes** | Fill dropdowns in **chains**, waiting for the next list to change, max 5 s |
| On a curated page, keyword guessing would fill wrong data (`txt_BenFatherFullNameEng` contains "name" → father's name = applicant's name; `txt_IncomeFrom*` contains "income") | Curated forms can set `"keywordFallback": false` |
| Some fields are read-only (applicant name, DOB from the login profile) | The fill never writes into read-only or disabled fields |
| DOB format on the portal is DD/MM/YYYY | `dmy` transform |
| Marathi name fields must hold Marathi | `devanagari` transform: fill only if the value is Devanagari, else leave for the operator |

**Decisions (user, 2026-11-14):** income split by source and the Aadhaar number are typed by
the operator; the income-certificate total is shown as a placeholder check figure.
Group No, Area and Unit are operator fields (Phase 9).

### 10.1 Create `forms/mahaonline-ews.json`

```json
{
  "name": "EWS 10% Self-Declaration (Aaple Sarkar / MahaOnline)",
  "urlPattern": ["/EWSSelftDeclaration/SelfDeclarationApplication", "/portal-ews.html"],
  "keywordFallback": false,
  "fields": {
    "#txt_relation_nameofBeneficaryEn": "identity.full_name_latin",
    "#txt_relation_nameofBeneficaryMar": "identity.full_name|devanagari",
    "#txt_RelationDOB": "identity.date_of_birth|dmy",
    "#Address_ApplicantAddress": "identity.address",
    "#Address_ApplicantPincode": "identity.pin_code",
    "#txtlandHolder_Name": "land.owner_names_latin.0",
    "#txtLandHolder_nameLL": "land.owner_names.0"
  },
  "selectChains": [
    [{ "id": "ddl_RelationGender_Value", "path": "identity.gender", "mode": "gender" }],
    [{ "id": "Address_DistrictCode", "path": "identity.address", "mode": "within" }],
    [
      { "id": "ddlland_dist_Value", "path": "land.taluka_and_district", "mode": "within" },
      { "id": "ddlland_subdist_Value", "path": "land.taluka_and_district", "mode": "within" },
      { "id": "ddlland_vill_Value", "path": "land.village_name", "mode": "within" }
    ]
  ],
  "operator": [
    "#txtgatno", "#txtland_Area", "#ddlland_unit_Value",
    "#txt_IncomeFromSalary", "#txt_IncomeFromBusiness", "#txt_IncomeFromAgriCulture",
    "#txt_IncomeFromInvestment", "#txt_IncomeFromOthers"
  ],
  "hints": {
    "#txt_IncomeFromSalary": "income.certified_annual_income",
    "#txt_IncomeFromBusiness": "income.certified_annual_income",
    "#txt_IncomeFromAgriCulture": "income.certified_annual_income",
    "#txt_IncomeFromInvestment": "income.certified_annual_income",
    "#txt_IncomeFromOthers": "income.certified_annual_income"
  }
}
```

Do not edit `forms/mahaonline-income.json`.

### 10.2 `src/fieldmap.js`

**(a)** Immediately after the closing `}` of `function loadForms() { ... }`, insert:

```js
/** Phase 10: urlPattern may be a string or an array of strings. */
function findCurated(url) {
  return loadForms().find((f) => url && [].concat(f.urlPattern || []).some((p) => url.includes(p)));
}

/**
 * Phase 10: optional transform after "|" in a curated path.
 *   devanagari - keep only if the value is Devanagari (Marathi fields must hold Marathi)
 *   dmy        - YYYY-MM-DD -> DD/MM/YYYY; anything else -> null
 */
function readCurated(profile, spec) {
  const [dotted, transform] = String(spec).split('|');
  const v = read(profile, dotted);
  if (v == null || v === 'NULL' || v === '') return null;
  const s = String(v);
  if (transform === 'devanagari') return /^[\u0900-\u097F\s.]+$/.test(s) ? s : null;
  if (transform === 'dmy') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }
  return s;
}

const GENDER_TEXT = {
  MALE: ['M', 'Male', 'पुरुष'],
  FEMALE: ['F', 'Female', 'स्त्री', 'महिला'],
  OTHER: ['T', 'Other', 'इतर', 'तृतीयपंथी'],
};
```

**(b)** In `matchFields`, find:
```js
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
```
Replace with:
```js
  const curated = findCurated(url);

  for (const field of fields) {
    // 1. Curated mapping for this form, keyed by the field's id or name.
    if (curated) {
      // Phase 10: operator fields are never filled from documents.
      if ((curated.operator || []).includes(`#${field.id}`)) continue;
      const dotted = curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name];
      if (dotted) {
        const v = readCurated(profile, dotted);
        if (v != null) { values[field.ref] = v; continue; }
      }
      // Phase 10: on a curated page, keyword guessing can put data in the wrong field.
      if (curated.keywordFallback === false) continue;
    }
```

**(c)** Replace the **whole** `operatorRefs` function (from its `/**` comment through its closing `}`) with:
```js
/**
 * Phase 9/10: refs of form fields the operator must type. The extension leaves these empty
 * and outlines them amber. Two sources:
 *   - the curated form's "operator" list (always), and
 *   - fields mapped to land.<k> where k is in profile.land.needs_operator.
 */
export function operatorRefs({ profile, url, fields }) {
  const pending = new Set((profile?.land?.needs_operator || []).map((k) => `land.${k}`));
  const curated = findCurated(url);
  const always = new Set(curated?.operator || []);
  const refs = [];

  for (const field of fields) {
    if (always.has(`#${field.id}`)) { refs.push(field.ref); continue; }
    if (!pending.size) continue;
    let dotted = curated ? (curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name]) : undefined;
    if (dotted) dotted = String(dotted).split('|')[0];
    if (!dotted && !(curated && curated.keywordFallback === false)) {
      const text = fieldText(field);
      const hit = text ? KEYWORDS.find((k) => k.words.some((w) => text.includes(w))) : null;
      dotted = hit ? hit.path : null;
    }
    if (dotted && pending.has(dotted)) refs.push(field.ref);
  }
  return refs;
}

/**
 * Phase 10: dropdown chains for the curated form. The extension picks each option by its
 * visible text (extension/pick.js), in order, waiting for dependent lists to load.
 * @returns {Array<Array<{id, mode, candidates?, source?}>>}
 */
export function selectChains({ profile, url }) {
  const curated = findCurated(url);
  if (!curated || !Array.isArray(curated.selectChains)) return [];
  return curated.selectChains.map((chain) => chain.map(({ id, path: p, mode }) => {
    const v = read(profile, p);
    if (mode === 'gender') {
      return { id, mode: 'oneOf', candidates: GENDER_TEXT[String(v || '').toUpperCase()] || [] };
    }
    return { id, mode: 'within', source: v == null || v === 'NULL' ? '' : String(v) };
  }));
}

/** Phase 10: check figures shown as placeholders in operator fields. ref -> value. */
export function hintRefs({ profile, url, fields }) {
  const curated = findCurated(url);
  if (!curated?.hints) return {};
  const out = {};
  for (const field of fields) {
    const p = curated.hints[`#${field.id}`];
    if (!p) continue;
    const v = read(profile, p);
    if (v != null && v !== 'NULL' && v !== '') out[field.ref] = String(v);
  }
  return out;
}
```

After this step, `grep -c "loadForms().find" src/fieldmap.js` must print `1` (only inside
`findCurated`). If not, STOP.

### 10.3 Create `extension/pick.js`

```js
// Phase 10: choose a <select> option by its VISIBLE TEXT. Pure, no DOM access.
// Loaded as a content script before content.js; tested in Node by src/pick.test.js.
// Option values on the real portal differ per language (gender GUIDs) or are codes
// (district 521 = Pune = पुणे), so text is the only stable key.
(function (root) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[,./()\-:]+/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * @param {Array<{value:string,text:string}>} options
   * @param {{mode:'oneOf',candidates:string[]}|{mode:'within',source:string}} spec
   * @returns {string|null} the option value to select, or null if no single clear match
   */
  function pickOption(options, spec) {
    const real = options.filter((o) => o.value !== '' && norm(o.text));

    if (spec.mode === 'oneOf') {
      const want = (spec.candidates || []).map(norm);
      const hits = real.filter((o) => want.includes(norm(o.text)));
      return hits.length === 1 ? hits[0].value : null;
    }

    if (spec.mode === 'within') {
      const src = norm(spec.source);
      if (!src) return null;
      // Whole words only: "वड" must not match inside "वडगाव".
      const padded = ` ${src} `;
      const hits = real.filter((o) => padded.includes(` ${norm(o.text)} `));
      if (!hits.length) return null;
      // Longest match wins; a tie is ambiguous and left to the operator.
      const max = Math.max(...hits.map((o) => norm(o.text).length));
      const best = hits.filter((o) => norm(o.text).length === max);
      return best.length === 1 ? best[0].value : null;
    }

    return null;
  }

  root.__govtechPick = { pickOption };
})(globalThis);
```

### 10.4 `extension/manifest.json`

Find:
```json
"js": ["content.js"]
```
Replace with:
```json
"js": ["pick.js", "content.js"]
```

### 10.5 `extension/content.js`

**(a)** In the fill handler, find:
```js
      if (!el) continue;
      el.value = value;
```
Replace with:
```js
      // Phase 10: dropdowns are handled by chains below; never write read-only fields.
      if (!el || el.tagName === 'SELECT' || el.readOnly || el.disabled) continue;
      el.value = value;
```

**(b)** Find:
```js
      el.title = T('land_operator_entry');
    }
    status(T('panel_filled').replace('{n}', r.matched).replace('{total}', r.total), 'okc');
```
Replace with:
```js
      el.title = T('panel_operator_field');
    }
    // Phase 10: a document figure shown as a placeholder, for the operator to check against.
    for (const [ref, v] of Object.entries(r.hints || {})) {
      const el = refs.get(ref);
      if (!el) continue;
      el.placeholder = T('panel_check_figure').replace('{n}', v);
    }
    // Phase 10: dropdowns, chosen by visible text. A later dropdown in a chain loads only
    // after the earlier one changes, so wait for its options to change (max 5 s).
    // If one link fails, the rest of that chain is left for the operator.
    const snap = (el) => [...el.options].map((o) => o.text).join('|');
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    let picked = 0;
    for (const chain of r.chains || []) {
      let broken = false;
      for (let i = 0; i < chain.length; i++) {
        const el = document.getElementById(chain[i].id);
        if (!el || el.tagName !== 'SELECT') { broken = true; continue; }
        if (broken) { el.style.outline = '3px solid #e69500'; continue; }
        const value = window.__govtechPick.pickOption(
          [...el.options].map((o) => ({ value: o.value, text: o.text })), chain[i]);
        if (value == null) { el.style.outline = '3px solid #e69500'; broken = true; continue; }
        el.style.outline = '2px solid #0a7d2c';
        picked++;
        if (el.value === value) continue;
        const next = chain[i + 1] && document.getElementById(chain[i + 1].id);
        const before = next && next.tagName === 'SELECT' ? snap(next) : null;
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (before !== null) {
          const t0 = Date.now();
          while (snap(next) === before && Date.now() - t0 < 5000) await sleep(200);
        }
      }
    }
    status(T('panel_filled').replace('{n}', r.matched + picked).replace('{total}', r.total), 'okc');
```

### 10.6 `src/web.js`

(a) Find `import { matchFields, operatorRefs } from './fieldmap.js';` → replace with
`import { matchFields, operatorRefs, selectChains, hintRefs } from './fieldmap.js';`

(b) Find:
```js
    'land_operator_entry',
  ];
```
Replace with:
```js
    'land_operator_entry', 'panel_operator_field', 'panel_check_figure',
  ];
```

(c) Find:
```js
    operator: operatorRefs({ profile, url, fields }),
```
Replace with:
```js
    operator: operatorRefs({ profile, url, fields }),
    chains: selectChains({ profile, url }),
    hints: hintRefs({ profile, url, fields }),
```

### 10.7 i18n — 2 new keys in all three catalogs

Insert immediately after the `"land_operator_entry"` line in each file. The team must
proofread the Hindi and Marathi (ADR-7).

`src/i18n/en.json`:
```json
  "panel_operator_field": "Type this from the paper document.",
  "panel_check_figure": "From document: {n}",
```
`src/i18n/hi.json`:
```json
  "panel_operator_field": "यह कागज़ी दस्तावेज़ से स्वयं भरें।",
  "panel_check_figure": "दस्तावेज़ के अनुसार: {n}",
```
`src/i18n/mr.json`:
```json
  "panel_operator_field": "हे कागदपत्रावरून स्वतः भरा.",
  "panel_check_figure": "कागदपत्रानुसार: {n}",
```

### 10.8 Create `public/portal-ews.html` — offline rehearsal copy

Same field ids, labels and dependent-dropdown behaviour as the real form, **no personal data**,
and a banner saying it is a demo copy. Write exactly:

```html
<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EWS 10% स्व-घोषणापत्र (डेमो प्रत)</title>
<style>
  body { font-family: 'Nirmala UI', sans-serif; background: #f4f6fb; color: #222; margin: 0; padding: 16px; }
  .demo { background: #d00000; color: #fff; padding: 8px 12px; font-weight: bold; margin-bottom: 12px; }
  h1 { font-size: 22px; color: #0b4f6c; }
  .sec { background: #fff; border: 1px solid #ddd; margin-bottom: 14px; }
  .sec h2 { background: #36495f; color: #fff; font-size: 16px; margin: 0; padding: 10px 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px 18px; padding: 14px; }
  label { display: block; font-size: 14px; margin-bottom: 4px; }
  input, select { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; font-size: 14px; }
  input[readonly] { background: #eee; }
  .req { color: #d00; }
  button { margin: 8px 14px 16px; padding: 10px 24px; font-size: 15px; }
  #result { padding: 0 14px 14px; font-weight: bold; color: #0a7d2c; }
</style>
</head>
<body>
<div class="demo">डेमो प्रत — DEMO COPY of the Aaple Sarkar "EWS 10% Self-Declaration" form for offline rehearsal. Field ids match the real portal. This is not a government website.</div>
<h1>EWS 10% स्व-घोषणापत्र</h1>

<div class="sec"><h2>अर्जदाराचे तपशील</h2><div class="grid">
  <div><label for="BasicInformation_ApplicantName">पूर्ण नाव (इंग्रजी) <span class="req">*</span></label><input id="BasicInformation_ApplicantName" value="DEMO APPLICANT" readonly></div>
  <div><label for="BasicInformation_ApplicantNameMarathi">पूर्ण नाव (मराठी) <span class="req">*</span></label><input id="BasicInformation_ApplicantNameMarathi" value="डेमो अर्जदार" readonly></div>
  <div><label for="BasicInformation_DateOfBirth">जन्मतारीख</label><input id="BasicInformation_DateOfBirth" value="" readonly></div>
  <div><label for="BasicInformation_ApplicantUIDNo">आधार क्रमांक</label><input id="BasicInformation_ApplicantUIDNo"></div>
  <div><label for="Address_ApplicantAddress">पत्ता <span class="req">*</span></label><input id="Address_ApplicantAddress"></div>
  <div><label for="Address_DistrictCode">जिल्हा <span class="req">*</span></label><select id="Address_DistrictCode" class="district"></select></div>
  <div><label for="Address_ApplicantPincode">पिनकोड क्र. <span class="req">*</span></label><input id="Address_ApplicantPincode"></div>
</div></div>

<div class="sec"><h2>लाभार्थीचे तपशील</h2><div class="grid">
  <div><label for="ddlbenfRelation_Value">लाभार्थीचे अर्जदारासोबतचे नाते <span class="req">*</span></label>
    <select id="ddlbenfRelation_Value"><option value="">---Select---</option><option value="r-self">Self</option><option value="r-son">Son</option><option value="r-daughter">Daughter</option><option value="r-wife">Wife</option></select></div>
  <div><label for="txt_relation_nameofBeneficaryEn">पूर्ण नाव (इंग्रजी) <span class="req">*</span></label><input id="txt_relation_nameofBeneficaryEn"></div>
  <div><label for="txt_relation_nameofBeneficaryMar">पूर्ण नाव (मराठी) <span class="req">*</span></label><input id="txt_relation_nameofBeneficaryMar"></div>
  <div><label for="txt_RelationDOB">जन्मतारीख</label><input id="txt_RelationDOB" placeholder="DD/MM/YYYY"></div>
  <div><label for="ddl_RelationGender_Value">लिंग <span class="req">*</span></label>
    <select id="ddl_RelationGender_Value"><option value="">---निवडा---</option><option value="11d79d04-3bcf-4389-9466-7e4ac80a5f5d">पुरुष</option><option value="3665f1da-cdc8-4443-8649-c70563ec758f">स्त्री</option><option value="4738a78e-a3b7-4e4d-8707-2545e49a9bfc">इतर</option></select></div>
  <div><label for="txt_UIDNo">आधार क्रमांक</label><input id="txt_UIDNo"></div>
  <div><label for="txtRelationCaste">जात <span class="req">*</span></label><input id="txtRelationCaste"></div>
</div></div>

<div class="sec"><h2>Details of Land</h2><div class="grid">
  <div><label for="txtlandHolder_Name">Land Holder Name (English)</label><input id="txtlandHolder_Name"></div>
  <div><label for="txtLandHolder_nameLL">Land Holder Name (Marathi)</label><input id="txtLandHolder_nameLL"></div>
  <div><label for="ddlland_dist_Value">District</label><select id="ddlland_dist_Value" class="district"></select></div>
  <div><label for="ddlland_subdist_Value">Taluka</label><select id="ddlland_subdist_Value"><option value="">---निवडा---</option></select></div>
  <div><label for="ddlland_vill_Value">Village</label><select id="ddlland_vill_Value"><option value="">---निवडा---</option></select></div>
  <div><label for="txtgatno">Group No</label><input id="txtgatno"></div>
  <div><label for="txtland_Area">Area</label><input id="txtland_Area" value="0"></div>
  <div><label for="ddlland_unit_Value">Unit</label>
    <select id="ddlland_unit_Value"><option value="">---निवडा---</option><option value="u-are">आर</option><option value="u-acre">एकर</option><option value="u-guntha">गुंठे</option><option value="u-ha">हेक्टर</option></select></div>
</div></div>

<div class="sec"><h2>Family income details from other resources</h2><div class="grid">
  <div><label for="txt_IncomeFromSalary">वेतन / मजुरी पासूनचे उत्पन्न <span class="req">*</span></label><input id="txt_IncomeFromSalary" class="inc"></div>
  <div><label for="txt_IncomeFromBusiness">व्यवसाय उद्योगापासूनचे उत्पन्न <span class="req">*</span></label><input id="txt_IncomeFromBusiness" class="inc"></div>
  <div><label for="txt_IncomeFromAgriCulture">कृषी उत्पन्न <span class="req">*</span></label><input id="txt_IncomeFromAgriCulture" class="inc"></div>
  <div><label for="txt_IncomeFromInvestment">गुंतवणुकीच्या स्तोत्रातून प्राप्ती <span class="req">*</span></label><input id="txt_IncomeFromInvestment" class="inc"></div>
  <div><label for="txt_IncomeFromOthers">वरील स्तोत्राव्यतिरिक्त उत्पन्न <span class="req">*</span></label><input id="txt_IncomeFromOthers" class="inc"></div>
  <div><label for="txt_totalIncome">एकूण उत्पन्न <span class="req">*</span></label><input id="txt_totalIncome" readonly></div>
</div></div>

<div class="sec"><div class="grid"><div><label><input type="checkbox" id="checkboxPrimary" style="width:auto"> I Agree</label></div></div>
  <button type="button" id="submitBtn">सादर करा</button>
  <div id="result"></div>
</div>

<script>
  // Dependent dropdowns, as on the real portal: the next list loads only after a change.
  // The delay imitates the portal's server round trip. Codes for districts are the real ones.
  var DISTRICTS = [['521', 'पुणे'], ['523', 'बीड'], ['524', 'लातूर'], ['527', 'सातारा'], ['528', 'रत्नागिरी']];
  var TALUKAS = {
    '521': [['4101', 'हवेली'], ['4102', 'मुळशी'], ['4103', 'मावळ'], ['4104', 'पुणे शहर'], ['4105', 'बारामती']],
    '527': [['4201', 'सातारा'], ['4202', 'कराड']]
  };
  var VILLAGES = {
    '4101': [['410101', 'वडगाव'], ['410102', 'वडगाव शेरी'], ['410103', 'खडकवासला'], ['410104', 'लोणी काळभोर']],
    '4102': [['410201', 'पौड']],
    '4202': [['420201', 'मलकापूर']]
  };
  function fill(sel, rows) {
    sel.innerHTML = '<option value="">---निवडा---</option>';
    rows.forEach(function (r) { var o = document.createElement('option'); o.value = r[0]; o.textContent = r[1]; sel.appendChild(o); });
  }
  document.querySelectorAll('select.district').forEach(function (s) { fill(s, DISTRICTS); });
  var land = { d: document.getElementById('ddlland_dist_Value'), t: document.getElementById('ddlland_subdist_Value'), v: document.getElementById('ddlland_vill_Value') };
  land.d.addEventListener('change', function () {
    fill(land.t, []); fill(land.v, []);
    setTimeout(function () { fill(land.t, TALUKAS[land.d.value] || []); }, 400);
  });
  land.t.addEventListener('change', function () {
    fill(land.v, []);
    setTimeout(function () { fill(land.v, VILLAGES[land.t.value] || []); }, 400);
  });
  document.querySelectorAll('input.inc').forEach(function (i) {
    i.addEventListener('input', function () {
      var sum = 0;
      document.querySelectorAll('input.inc').forEach(function (x) { sum += Number(x.value) || 0; });
      document.getElementById('txt_totalIncome').value = sum;
    });
  });
  // D11: this product never submits. The stub only shows text.
  document.getElementById('submitBtn').addEventListener('click', function () {
    document.getElementById('result').textContent = 'सादर केले';
  });
</script>
</body>
</html>
```

### 10.9 Create `src/pick.test.js` and add it to `npm test`

```js
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
```

In `package.json`, find:
```
node src/simulate.test.js",
```
Replace with:
```
node src/simulate.test.js && node src/pick.test.js",
```

### 10.10 `src/fieldmap.test.js` — 12 new checks

Find `import { matchFields, operatorRefs } from './fieldmap.js';` → replace with
`import { matchFields, operatorRefs, selectChains, hintRefs } from './fieldmap.js';`

Find:
```js
console.log(`\n${pass} passed, ${fail} failed\n`);
```
Insert immediately **before** it:
```js
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
```

### 10.11 Verify

```bash
npm test
node src/fieldmap.test.js | grep passed
node --check extension/content.js && node --check extension/pick.js && echo "ext ok"
node -e "JSON.parse(require('fs').readFileSync('forms/mahaonline-ews.json','utf8'));console.log('form ok')"
```
Expected, in order: `31`, `28`, `16`, `19`, `13`, `9` passed (all `0 failed`); then
`31 passed, 0 failed`; then `ext ok`; then `form ok`.

Then with the server running (`npm start`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/portal-ews.html
```
Expected: `200`.

Do not open the real portal. Do not load or test the extension in a browser — the planner
verifies that with the user.

---

## PHASE 11 — Incomplete clients can be filled

**Decision (user, 2026-11-14):** a client missing a document can still be selected and its
form filled from the documents it has. Validation is unchanged and still reports the
missing document. Reason: on the EWS form the income certificate feeds only a check figure;
the five income fields are operator-typed. A citizen who forgot one document should still
get the rest of the form filled at the counter.

### 11.1 `extension/content.js`

Find:
```js
      o.disabled = !c.ready;
```
Replace with:
```js
      // Phase 11: incomplete clients stay selectable; Validate still reports what is missing.
```

### 11.2 Verify

```bash
grep -c "o.disabled" extension/content.js
node --check extension/content.js && echo "content ok"
npm test
```
Expected: `0`; `content ok`; 31, 28, 16, 19, 13, 9 passed, all 0 failed.

---

## PHASE 12 — Panel says what is missing, and why nothing filled

**Found in the user's Chrome test, 2026-11-14:** Validate showed a blank box for an
incomplete client, because the route returns `missing` and the panel only renders `errors`
and `notices`. Fill reported "0 of 34" with no reason when no documents had been read yet.

**Decision (planner):** in the extension's validate route, `purpose` is not reported as
missing. It is present on no document and the EWS portal form has no purpose field; on the
extension path it is collected by the portal itself. The WhatsApp and web routes are unchanged.

### 12.1 `src/web.js` — validate route

Find:
```js
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  res.json({
    ok: result.ok,
    missing: result.missing,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
    notices: (result.notices || []).map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
```
Replace with:
```js
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  // Phase 12: purpose is on no document and the portal collects it itself.
  const missing = result.missing.filter((m) => m !== 'purpose');
  res.json({
    ok: result.errors.length === 0 && missing.length === 0,
    missing,
    missing_message: missing.length
      ? t(lang, 'panel_missing', { list: missing.map((m) => t(lang, `doc_${m}`)).join(', ') })
      : null,
    errors: result.errors.map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
    notices: (result.notices || []).map((e) => ({ key: e.key, message: t(lang, e.key, e.params) })),
  });
```
If this block matches more than once, STOP.

### 12.2 `src/web.js` — serve the new panel key

Find:
```js
    'land_operator_entry', 'panel_operator_field', 'panel_check_figure',
```
Replace with:
```js
    'land_operator_entry', 'panel_operator_field', 'panel_check_figure', 'panel_fill_nothing',
```

### 12.3 i18n — 5 new keys in all three catalogs

Insert immediately after the `"panel_check_figure"` line in each file. Team to proofread (ADR-7).

`src/i18n/en.json`:
```json
  "panel_missing": "Missing documents: {list}",
  "doc_identity": "Aadhaar card",
  "doc_income": "Income certificate",
  "doc_land": "7/12 land record",
  "panel_fill_nothing": "Nothing filled — this client's documents have not been read yet, or this page has no matching fields.",
```
`src/i18n/hi.json`:
```json
  "panel_missing": "ये दस्तावेज़ नहीं मिले: {list}",
  "doc_identity": "आधार कार्ड",
  "doc_income": "आय प्रमाण पत्र",
  "doc_land": "७/१२ भूमि अभिलेख",
  "panel_fill_nothing": "कुछ नहीं भरा गया — इस ग्राहक के दस्तावेज़ अभी पढ़े नहीं गए हैं, या इस पेज पर मिलते-जुलते फ़ील्ड नहीं हैं।",
```
`src/i18n/mr.json`:
```json
  "panel_missing": "हे कागदपत्र मिळाले नाहीत: {list}",
  "doc_identity": "आधार कार्ड",
  "doc_income": "उत्पन्नाचा दाखला",
  "doc_land": "७/१२ उतारा",
  "panel_fill_nothing": "काहीच भरले नाही — या ग्राहकाची कागदपत्रे अजून वाचली गेली नाहीत, किंवा या पानावर जुळणारी फील्ड नाहीत.",
```

### 12.4 `extension/content.js`

**(a)** In the validate handler, find:
```js
    // Phase 9: fields the operator types from paper. Amber, not red: not a failure.
```
Replace with:
```js
    // Phase 12: an incomplete client used to show a blank box.
    if (r.missing_message) {
      const d = document.createElement('div'); d.className = 'err'; d.textContent = r.missing_message; out.appendChild(d);
    }
    // Phase 9: fields the operator types from paper. Amber, not red: not a failure.
```

**(b)** Find:
```js
    status(T('panel_filled').replace('{n}', r.matched + picked).replace('{total}', r.total), 'okc');
```
Replace with:
```js
    // Phase 12: say why, instead of "0 of 34".
    if (r.matched + picked === 0) status(T('panel_fill_nothing'), 'err');
    else status(T('panel_filled').replace('{n}', r.matched + picked).replace('{total}', r.total), 'okc');
```

### 12.5 Verify

```bash
npm test
node src/fieldmap.test.js | grep passed
node --check extension/content.js && echo "content ok"
NO_LISTEN=true node -e "import('./src/web.js').then(()=>console.log('web ok'))"
```
Expected: 31, 28, 16, 19, 13, 9 passed (all 0 failed); `31 passed, 0 failed`; `content ok`; `web ok`.

Do not start, stop or restart the server on port 3000 — the user is running it.

---

## PHASE 13 — BUILD_SPEC §5.1 check 6 (format), never built

**Defect:** BUILD_SPEC §5.1 specifies six checks. Check 6 — *"PIN code exactly 6 digits;
survey number non-empty"* — was never implemented and no test covered it. This phase builds
it exactly as specified. A survey number the operator types from paper (Phase 9
`needs_operator`) is exempt, like the other operator fields.

### 13.1 `src/rulebook.js`

Find:
```js
  // --- field present on no document ---
```
Replace with:
```js
  // --- format: BUILD_SPEC §5.1 check 6 ---
  const pin = toAsciiDigits(identity.pin_code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(pin)) {
    errors.push({ key: 'pin_invalid', params: { p: identity.pin_code ?? '—' } });
  }
  const survey = land.survey_number;
  const surveyEmpty = survey == null || survey === 'NULL' || String(survey).trim() === '';
  if (surveyEmpty && !operatorFields.includes('survey_number')) {
    errors.push({ key: 'survey_missing', params: {} });
  }

  // --- field present on no document ---
```
If the find string does not occur exactly once, STOP.

### 13.2 i18n — 2 new keys in all three catalogs

Insert immediately after the `"land_date_unreadable"` line in each file. Team to proofread (ADR-7).

`src/i18n/en.json`:
```json
  "pin_invalid": "Problem found: the PIN code on the Aadhaar card reads {p}, which is not 6 digits. Please check it against the card.",
  "survey_missing": "I could not read the survey number on the 7/12 extract. Please resend it.",
```
`src/i18n/hi.json`:
```json
  "pin_invalid": "समस्या मिली: आधार कार्ड पर पिन कोड {p} पढ़ा गया, जो ६ अंकों का नहीं है। कृपया कार्ड से मिलान करें।",
  "survey_missing": "७/१२ अभिलेख पर सर्वे नंबर नहीं पढ़ा जा सका। कृपया दोबारा भेजें।",
```
`src/i18n/mr.json`:
```json
  "pin_invalid": "अडचण आढळली: आधार कार्डवरील पिन कोड {p} असा वाचला गेला, जो ६ अंकी नाही. कृपया कार्डवरून तपासा.",
  "survey_missing": "७/१२ उताऱ्यावरील सर्व्हे नंबर वाचता आला नाही. कृपया पुन्हा पाठवा.",
```

### 13.3 `src/rulebook.test.js` — 5 new checks

Find:
```js
console.log(`\n${pass} passed, ${fail} failed\n`);
```
Insert immediately **before** it:
```js
console.log('\nFormat (BUILD_SPEC §5.1 check 6)');
const withPin = (p) => validateEWS({ ...base, identity: { ...load('identity'), pin_code: p }, land: load('land') }, NOW);
check('5-digit PIN rejected', withPin('43171').errors.some((e) => e.key === 'pin_invalid'));
check('NULL PIN rejected', withPin('NULL').errors.some((e) => e.key === 'pin_invalid'));
check('Devanagari-digit PIN accepted', !withPin('४३१७१४').errors.some((e) => e.key === 'pin_invalid'));
const noSurvey = validateEWS({ ...base, land: { ...load('land'), survey_number: '' } }, NOW);
check('empty survey number rejected', noSurvey.errors.some((e) => e.key === 'survey_missing'));
check('operator-typed survey number exempt', !op.errors.some((e) => e.key === 'survey_missing'));
```

### 13.4 Verify

```bash
npm test
node src/fieldmap.test.js | grep passed
node -e "for (const l of ['en','hi','mr']) { const j=JSON.parse(require('fs').readFileSync('src/i18n/'+l+'.json','utf8')); console.log(l, Object.keys(j).length) }"
```
Expected: `36`, `28`, `16`, `19`, `13`, `9` passed (all `0 failed`); `31 passed, 0 failed`;
then `en 68`, `hi 68`, `mr 68`.

Do not start, stop or restart the server on port 3000.

---

## PHASE 14 — Build §00 in full: keybinds + bottom pop-ups, upload capture, PDF, auto-validate, watch, ADR-8

Builds R1–R8 of §00 and the unmet D5 / "auto-validate" / "directory watch" / ADR-8 items.
Two halves with **no shared files**, built in parallel:

- **Part A — server** (`src/`, `forms/`, `src/i18n/`)
- **Part B — extension** (`extension/` only)

The contract between them is section 14.0. Neither half edits the other's files.

### 14.0 Contract

**Keybinds (R7, D5).** Chrome command names and default keys:

| Command | Default key | Feature |
|---|---|---|
| `fill-form` | Ctrl+Shift+F | FILL — validate + fill the form from the client's documents |
| `voice-chat` | Alt+Shift+V | VOICE — speak or type into the clicked field |
| `change-format` | Alt+Shift+C | FORMAT — convert both ways: JPEG ↔ PNG ↔ WEBP, image ↔ PDF, text ↔ PDF |
| `compress` | Alt+Shift+Z | COMPRESS — shrink an image or PDF to a KB limit |
| `pick-client` | none (user sets it on `chrome://extensions/shortcuts`) | CLIENT — choose the client |

Upload capture (R1) has no key: it runs whenever a file is picked in a page's `<input type="file">`.

**New server route** (Part A builds, Part B calls):
`POST /api/check-upload` body `{ client, label, fileName, imageBase64, lang }` →
`{ ok, docType, docName, errors:[{key,message}], notices:[{key,message}], okMessage }`
or `{ ok:false, error }` with status 500.

**`POST /api/fill`** response gains `verify: [ref]` (Part A).

**New i18n keys** (Part A adds; Part B reads through `/api/strings`): `name_unreadable`,
`upload_checking`, `upload_ok`, `upload_unknown_doc`, `upload_format_bad`, `pop_upload`,
`pop_summary`, `pop_listening`, `pop_to_text`, `pop_to_pages`, `pop_convert`, `pop_compress`,
`pop_choose_client`, `pop_no_option`, `panel_verify_field`.

---

## PART A — server

### A1. `src/rulebook.js` — per-document validation (R1, R8)

Append at the end of the file:

```js
/**
 * Phase 14 (R1, R8): validate ONE document on its own — the upload-capture check.
 * The same BUILD_SPEC §5.1 rules as validateEWS, applied to what this one document can be
 * judged on, plus a same-person check against the client's other documents when known.
 * Judges only; produces no data for filling.
 * @returns {{ok:boolean, errors:Array, notices:Array}}
 */
export function validateDocument(docType, doc, { profile = {}, now = new Date() } = {}) {
  const errors = [];
  const notices = [];
  const nm = (v) => (v && v !== 'NULL' ? v : '');
  if (!doc) return { ok: false, errors: [{ key: 'extract_failed', params: {} }], notices };

  if (docType === 'identity') {
    if (doc.image_quality_flag === true) {
      errors.push({ key: 'blurry_retry', params: {} });
      return { ok: false, errors, notices };
    }
    const idName = nm(matchName(doc, 'full_name'));
    if (!idName) errors.push({ key: 'name_unreadable', params: {} });
    const pin = toAsciiDigits(doc.pin_code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(pin)) errors.push({ key: 'pin_invalid', params: { p: doc.pin_code ?? '—' } });
    if (idName && profile.land) {
      const owners = matchNameList(profile.land, 'owner_names');
      if (owners.length && !owners.some((o) => namesMatch(idName, o))) {
        errors.push({ key: 'name_mismatch', params: { a: doc.full_name || idName, b: (profile.land.owner_names || [])[0] || owners[0] } });
      }
    }
    const incName = profile.income ? nm(matchName(profile.income, 'applicant_name')) : '';
    if (idName && incName && !namesMatch(idName, incName)) {
      errors.push({ key: 'income_name_mismatch', params: { a: doc.full_name || idName, b: profile.income.applicant_name } });
    }
  }

  if (docType === 'income') {
    const incName = nm(matchName(doc, 'applicant_name'));
    if (!incName) errors.push({ key: 'name_unreadable', params: {} });
    const age = monthsSince(doc.issue_date, now);
    if (age === null) errors.push({ key: 'income_date_unreadable', params: {} });
    else if (age > INCOME_CERT_MAX_AGE_MONTHS) errors.push({ key: 'income_stale', params: { d: doc.issue_date } });
    const amount = Number(String(doc.certified_annual_income).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) errors.push({ key: 'income_unreadable', params: {} });
    else if (amount > EWS_INCOME_CEILING) errors.push({ key: 'income_too_high', params: { n: amount.toLocaleString('en-IN') } });
    const idName = profile.identity ? nm(matchName(profile.identity, 'full_name')) : '';
    if (idName && incName && !namesMatch(idName, incName)) {
      errors.push({ key: 'income_name_mismatch', params: { a: profile.identity.full_name || idName, b: doc.applicant_name } });
    }
  }

  if (docType === 'land') {
    const op = Array.isArray(doc.needs_operator) ? doc.needs_operator : [];
    if (op.length) notices.push({ key: 'land_operator_entry', params: {} });
    const owners = matchNameList(doc, 'owner_names').filter((o) => nm(o));
    if (!owners.length) errors.push({ key: 'name_unreadable', params: {} });
    const age = monthsSince(doc.record_print_date, now);
    if (age === null) {
      if (!op.includes('record_print_date')) errors.push({ key: 'land_date_unreadable', params: {} });
    } else if (age > LAND_RECORD_MAX_AGE_MONTHS) {
      errors.push({ key: 'land_stale', params: { d: doc.record_print_date } });
    }
    const ha = parseHectares(doc.total_area_hectares);
    if (ha === null) {
      if (!op.includes('total_area_hectares')) errors.push({ key: 'land_area_unreadable', params: {} });
    } else if (ha >= LAND_AREA_MAX_HECTARES) {
      errors.push({ key: 'land_too_large', params: { n: ha.toFixed(2) } });
    }
    const s = doc.survey_number;
    if ((s == null || s === 'NULL' || String(s).trim() === '') && !op.includes('survey_number')) {
      errors.push({ key: 'survey_missing', params: {} });
    }
    const idName = profile.identity ? nm(matchName(profile.identity, 'full_name')) : '';
    if (idName && owners.length && !owners.some((o) => namesMatch(idName, o))) {
      errors.push({ key: 'name_mismatch', params: { a: profile.identity.full_name || idName, b: (doc.owner_names || [])[0] || owners[0] } });
    }
  }

  return { ok: errors.length === 0, errors, notices };
}
```

### A2. `src/rulebook.test.js` — 8 new checks

Change the import line to also import `validateDocument`:
`import { validateEWS, namesMatch, monthsSince, parseHectares, toAsciiDigits, validateDocument } from './rulebook.js';`

Insert immediately **before** `console.log(\`\n${pass} passed, ${fail} failed\n\`);`:

```js
console.log('\nPer-document validation (Phase 14, upload capture)');
const vd = (type, doc, profile = {}) => validateDocument(type, doc, { profile, now: NOW });
check('Aadhaar alone passes', vd('identity', load('identity')).ok === true);
check('Aadhaar with bad PIN fails', vd('identity', { ...load('identity'), pin_code: '4317' }).errors.some((e) => e.key === 'pin_invalid'));
check('Aadhaar vs other person\'s 7/12 caught', vd('identity', load('identity'), { land: load('land_mismatch') }).errors.some((e) => e.key === 'name_mismatch'));
check('income certificate alone passes', vd('income', load('income')).ok === true);
check('stale income certificate caught', vd('income', { ...load('income'), issue_date: '2025-01-01' }).errors.some((e) => e.key === 'income_stale'));
check('income certificate of another person caught',
  vd('income', { ...load('income'), applicant_name: 'Suresh Kale', applicant_name_latin: 'Suresh Kale' }, { identity: load('identity') })
    .errors.some((e) => e.key === 'income_name_mismatch'));
check('7/12 of the same person passes', vd('land', load('land'), { identity: load('identity') }).ok === true);
check('operator-typed 7/12 numbers raise a notice, not an error', (() => {
  const r = vd('land', { ...load('land'), survey_number: null, total_area_hectares: null, record_print_date: null,
    needs_operator: ['survey_number', 'total_area_hectares', 'record_print_date'] });
  return r.ok === true && r.notices.some((n) => n.key === 'land_operator_entry');
})());
```

### A3. `src/extractor.js` — document classification and ADR-8 flag

**(a)** In `SCHEMAS.identity`, find:
```
  "full_name_latin": "String - The same name in Roman script. If the document prints an English version, copy that EXACTLY. Otherwise transliterate it.",
```
Replace with:
```
  "full_name_latin": "String - The same name in Roman script. If the document prints an English version, copy that EXACTLY. Otherwise transliterate it.",
  "full_name_latin_printed": "Boolean - true if that Roman-script name is printed on the document, false if you transliterated it",
```

**(b)** Append at the end of the file:
```js
/**
 * Phase 14 (R1): which document is this? Used by upload capture when the upload slot's
 * label does not say. Returns 'identity' | 'income' | 'land' | null. Mock mode: null.
 */
export async function classifyDocument(imageBuffer) {
  if (USE_MOCK) return null;
  const raw = await ollamaGenerate(
    {
      prompt: 'Which document is this image? Answer with exactly one word: AADHAAR, INCOME, LAND or OTHER. LAND means a 7/12 extract (सातबारा) or another land record. INCOME means an income certificate (उत्पन्नाचा दाखला / आय प्रमाण पत्र).',
      images: [imageBuffer.toString('base64')],
    },
    { num_predict: 5 },
  );
  const w = String(raw).toUpperCase();
  if (w.includes('AADHAAR')) return 'identity';
  if (w.includes('INCOME')) return 'income';
  if (w.includes('LAND')) return 'land';
  return null;
}
```

### A4. `src/clients.js` — watch MASTER (D3, PS "automated")

**(a)** Find `import fs from 'node:fs/promises';` → replace with:
```js
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
```

**(b)** Append at the end of the file:
```js
/**
 * Phase 14 (D3, PS "automated"): watch MASTER/ so a document dropped into a folder is read
 * without a restart. Debounced; never two scans at once. Only image files trigger a scan,
 * so writing a .json cache does not trigger another.
 */
export function watchMaster() {
  let timer = null;
  let running = false;
  let again = false;
  const scan = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await warmAll(); } catch (e) { console.error('[watch]', e.message); }
    running = false;
    if (again) { again = false; scan(); }
  };
  try {
    fsSync.watch(MASTER, { recursive: true }, (_event, file) => {
      if (!file || !IMAGE_EXT.has(path.extname(String(file)).toLowerCase())) return;
      clearTimeout(timer);
      timer = setTimeout(scan, 1500);
    });
    console.log(`[clients] watching ${MASTER}`);
  } catch (e) {
    console.error('[clients] watch unavailable:', e.message);
  }
}
```

### A5. `src/server.js` — start the watcher

Find:
```js
  import('./clients.js').then((m) => m.warmAll()).catch((e) => console.error('[warm]', e.message));
```
Replace with:
```js
  import('./clients.js')
    .then(async (m) => { await m.warmAll(); m.watchMaster(); })
    .catch((e) => console.error('[warm]', e.message));
```

### A6. `src/fieldmap.js` — ADR-8 verify flags

Append at the end of the file:
```js
/**
 * Phase 14 (ADR-8): refs of filled fields whose value may be a machine transliteration rather
 * than text printed on the document. The extension fills them but outlines them dashed amber
 * with a "check against the document" hint.
 *   curated.verify       - always flagged
 *   curated.verifyUnless - flagged unless the given profile path is exactly true
 */
export function verifyRefs({ profile, url, fields }) {
  const curated = findCurated(url);
  if (!curated) return [];
  const always = new Set(curated.verify || []);
  const unless = curated.verifyUnless || {};
  const refs = [];
  for (const field of fields) {
    const key = `#${field.id}`;
    if (always.has(key)) { refs.push(field.ref); continue; }
    if (unless[key] && read(profile, unless[key]) !== true) refs.push(field.ref);
  }
  return refs;
}
```

### A7. Curated forms

`forms/mahaonline-ews.json`: find `  "hints": {` → replace with:
```
  "verify": ["#txt_relation_nameofBeneficaryMar", "#txtlandHolder_Name"],
  "verifyUnless": { "#txt_relation_nameofBeneficaryEn": "identity.full_name_latin_printed" },
  "hints": {
```
(The Marathi beneficiary name is always flagged: Phase 8 measured that the model converts other
Indic scripts to Devanagari. The 7/12 owner's English name is always a transliteration.)

`forms/mahaonline-income.json`: find `  "urlPattern": "/portal.html",` → replace with:
```
  "urlPattern": "/portal.html",
  "verifyUnless": { "#applicantName": "identity.full_name_latin_printed" },
```

### A8. `src/fieldmap.test.js` — 3 new checks

Change the import to add `verifyRefs`:
`import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs } from './fieldmap.js';`

Insert immediately **before** `console.log(\`\n${pass} passed, ${fail} failed\n\`);`:
```js
console.log('\nADR-8 verify flags (Phase 14)');
const vr = verifyRefs({ profile, url: EWS, fields: [...ewsFields, E('k', 'txtLandHolder_nameLL')] });
check('Marathi beneficiary and 7/12 English owner always flagged; printed Marathi owner not',
  vr.includes('b') && vr.includes('d') && !vr.includes('k'));
check('English name flagged when not known to be printed', vr.includes('a'));
const printedProfile = { ...profile, identity: { ...profile.identity, full_name_latin_printed: true } };
check('English name not flagged when printed on the card',
  !verifyRefs({ profile: printedProfile, url: EWS, fields: ewsFields }).includes('a'));
```

### A9. `src/web.js`

**(a)** Find `import { validateEWS } from './rulebook.js';` → replace with
`import { validateEWS, validateDocument } from './rulebook.js';`

**(b)** Find `import { matchFields, operatorRefs, selectChains, hintRefs } from './fieldmap.js';` → replace with
`import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs } from './fieldmap.js';`

**(c)** Find `    hints: hintRefs({ profile, url, fields }),` → replace with:
```js
    hints: hintRefs({ profile, url, fields }),
    verify: verifyRefs({ profile, url, fields }),
```

**(d)** Find `'panel_check_figure', 'panel_fill_nothing',` → replace with:
```js
'panel_check_figure', 'panel_fill_nothing',
    'name_unreadable', 'upload_checking', 'upload_ok', 'upload_unknown_doc', 'upload_format_bad',
    'pop_upload', 'pop_summary', 'pop_listening', 'pop_to_text', 'pop_to_pages', 'pop_convert',
    'pop_compress', 'pop_choose_client', 'pop_no_option', 'panel_verify_field',
```

**(e)** Append at the end of the file:
```js
/** Phase 14 (R1): upload slots name their document; this reads the label. */
const UPLOAD_WORDS = [
  ['identity', ['aadhaar', 'aadhar', 'adhaar', 'आधार', 'identity', 'ओळख', 'पहचान']],
  ['income', ['income', 'उत्पन्न', 'आय']],
  ['land', ['7/12', '७/१२', 'satbara', 'सातबारा', '8a', '८अ', 'land record', 'जमीन', 'भूमि']],
];
function docTypeFromLabel(label) {
  const s = String(label || '').toLowerCase();
  for (const [type, words] of UPLOAD_WORDS) if (words.some((w) => s.includes(w))) return type;
  return null;
}

/**
 * Phase 14 (R1): automated pre-submission check of ONE uploaded document. Called by the
 * extension when a file is picked in a portal upload slot. Reads it, judges it, reports.
 * Never blocks the upload.
 */
web.post('/api/check-upload', async (req, res) => {
  const { client, label, fileName, imageBase64, lang: l } = req.body || {};
  const lang = LANGUAGES.includes(l) ? l : 'en';
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
  const buffer = Buffer.from(String(imageBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const tr = (e) => ({ key: e.key, message: t(lang, e.key, e.params) });
  try {
    const { classifyDocument } = await import('./extractor.js');
    const docType = docTypeFromLabel(label) || await classifyDocument(buffer);
    if (!docType) {
      return res.json({ ok: false, docType: null, docName: null,
        errors: [tr({ key: 'upload_unknown_doc', params: {} })], notices: [], okMessage: null });
    }
    const doc = await extractDocument(buffer, docType);
    const profile = client ? await getProfile(client) : {};
    const r = validateDocument(docType, doc, { profile });
    res.json({
      ok: r.ok,
      docType,
      docName: t(lang, `doc_${docType}`),
      errors: r.errors.map(tr),
      notices: r.notices.map(tr),
      okMessage: r.ok ? t(lang, 'upload_ok', { f: fileName || '' }) : null,
    });
  } catch (err) {
    console.error('[check-upload]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```
Before writing (e), confirm `extractDocument`, `getProfile`, `LANGUAGES` and `t` are already
imported in `src/web.js`. If any is not, STOP.

### A10. i18n — 15 new keys in all three catalogs

Insert immediately after the `"panel_check_figure"` line in each file. Team to proofread (ADR-7).

`src/i18n/en.json`:
```json
  "name_unreadable": "I could not read the name on this document. Please use a clearer photo.",
  "upload_checking": "Checking {f}…",
  "upload_ok": "{f}: no problems found — this document should not be rejected.",
  "upload_unknown_doc": "I could not tell which document this is. Expected an Aadhaar card, income certificate or 7/12 extract.",
  "upload_format_bad": "{f} is a {t} file, but this upload slot accepts {a}.",
  "pop_upload": "Document check",
  "pop_summary": "{n} filled · {o} for you to type · {c} to check",
  "pop_listening": "Listening… click Stop when done.",
  "pop_to_text": "Text (from PDF)",
  "pop_to_pages": "one image per page (from PDF)",
  "pop_convert": "Convert",
  "pop_compress": "Compress",
  "pop_choose_client": "Choose a client first.",
  "pop_no_option": "No matching option in this list.",
  "panel_verify_field": "Check this spelling against the document — it may not be printed in this script.",
```
`src/i18n/hi.json`:
```json
  "name_unreadable": "इस दस्तावेज़ पर नाम नहीं पढ़ा जा सका। कृपया साफ़ फ़ोटो लगाएँ।",
  "upload_checking": "{f} की जाँच हो रही है…",
  "upload_ok": "{f}: कोई समस्या नहीं मिली — यह दस्तावेज़ अस्वीकार नहीं होना चाहिए।",
  "upload_unknown_doc": "यह कौन सा दस्तावेज़ है, पहचाना नहीं जा सका। आधार कार्ड, आय प्रमाण पत्र या ७/१२ अभिलेख अपेक्षित है।",
  "upload_format_bad": "{f} एक {t} फ़ाइल है, लेकिन यह अपलोड स्थान {a} स्वीकार करता है।",
  "pop_upload": "दस्तावेज़ जाँच",
  "pop_summary": "{n} भरे गए · {o} आपको भरने हैं · {c} जाँचने हैं",
  "pop_listening": "सुन रहे हैं… पूरा होने पर रोकें दबाएँ।",
  "pop_to_text": "टेक्स्ट (PDF से)",
  "pop_to_pages": "हर पेज की एक इमेज (PDF से)",
  "pop_convert": "बदलें",
  "pop_compress": "आकार घटाएँ",
  "pop_choose_client": "पहले ग्राहक चुनें।",
  "pop_no_option": "इस सूची में मेल खाता विकल्प नहीं है।",
  "panel_verify_field": "इस वर्तनी को दस्तावेज़ से मिलाएँ — यह शायद इस लिपि में छपा नहीं है।",
```
`src/i18n/mr.json`:
```json
  "name_unreadable": "या कागदपत्रावरील नाव वाचता आले नाही. कृपया स्पष्ट फोटो वापरा.",
  "upload_checking": "{f} तपासत आहे…",
  "upload_ok": "{f}: कोणतीही अडचण आढळली नाही — हे कागदपत्र नाकारले जाऊ नये.",
  "upload_unknown_doc": "हे कोणते कागदपत्र आहे ते ओळखता आले नाही. आधार कार्ड, उत्पन्नाचा दाखला किंवा ७/१२ उतारा अपेक्षित आहे.",
  "upload_format_bad": "{f} ही {t} फाइल आहे, पण हे अपलोड ठिकाण {a} स्वीकारते.",
  "pop_upload": "कागदपत्र तपासणी",
  "pop_summary": "{n} भरले · {o} तुम्ही भरायचे · {c} तपासायचे",
  "pop_listening": "ऐकत आहे… पूर्ण झाल्यावर थांबवा दाबा.",
  "pop_to_text": "मजकूर (PDF मधून)",
  "pop_to_pages": "प्रत्येक पानाची एक प्रतिमा (PDF मधून)",
  "pop_convert": "रूपांतर करा",
  "pop_compress": "आकार कमी करा",
  "pop_choose_client": "आधी ग्राहक निवडा.",
  "pop_no_option": "या यादीत जुळणारा पर्याय नाही.",
  "panel_verify_field": "हे शब्दलेखन कागदपत्राशी तपासा — हे कदाचित या लिपीत छापलेले नाही.",
```

### A11. Verify Part A

```bash
npm test
node src/fieldmap.test.js | grep passed
node -e "for (const l of ['en','hi','mr']) { const j=JSON.parse(require('fs').readFileSync('src/i18n/'+l+'.json','utf8')); console.log(l, Object.keys(j).length) }"
NO_LISTEN=true node -e "import('./src/web.js').then(()=>console.log('web ok'))"
node -e "import('./src/clients.js').then(m=>console.log(typeof m.watchMaster))"
```
Expected: `44`, `28`, `16`, `19`, `13`, `9` passed (all 0 failed); `34 passed, 0 failed`;
`en 83`, `hi 83`, `mr 83`; `web ok`; `function`.
Do not start, stop or restart the server on port 3000.

---

### A12. Validation judges every document present (user requirement, 2026-11-13 #124)

> *"the purpose is to ensure that the docs are not rejected by the real govt site… not that it
> blocks until all three are of same person, just that it acknowledges there is this info about
> one person"*

The client validate route used `validateEWS`, which stops at BUILD_SPEC §5.1 step 2 when a
document is missing — so an Aadhaar and a 7/12 of different people showed only "missing income
certificate". The user's requirement overrides that step for the extension: judge every document
that is present, with every cross-check possible, and list what is missing alongside.
`validateEWS` itself is unchanged (the WhatsApp chat flow still uses it).

In `src/web.js`, find:
```js
  const profile = await getProfile(req.params.key);
  const result = validateEWS(profile);
  // Phase 12: purpose is on no document and the portal collects it itself.
```
Replace with:
```js
  const profile = await getProfile(req.params.key);
  // A12 (#124): judge every document present, even when another is missing. validateEWS
  // supplies completeness and the all-three checks; validateDocument adds per-document and
  // pairwise checks. Duplicates (same key and params) are reported once.
  const full = validateEWS(profile);
  const seen = new Set();
  const errors = [];
  const notices = [];
  const add = (list, items) => {
    for (const e of items || []) {
      const k = JSON.stringify([e.key, e.params]);
      if (!seen.has(k)) { seen.add(k); list.push(e); }
    }
  };
  add(errors, full.errors);
  add(notices, full.notices);
  for (const type of ['identity', 'income', 'land']) {
    if (!profile[type]) continue;
    const r = validateDocument(type, profile[type], { profile });
    add(errors, r.errors);
    add(notices, r.notices);
  }
  const result = { ...full, errors, notices };
  // Phase 12: purpose is on no document and the portal collects it itself.
```
If the find string does not occur exactly once, STOP.

Verify:
```bash
npm test
node --check src/web.js && echo "web ok"
NO_LISTEN=true node -e "import('./src/web.js').then(()=>console.log('import ok'))"
```
Expected: 44, 28, 16, 19, 13, 9 passed (all 0 failed); `web ok`; `import ok`.
Do not start, stop or restart the server on port 3000.

---

### A13. Curated forms only — no general-purpose filling (user requirement R5, #66.5)

> *"Manual form integration - train workflow around specific checked and saved forms, why?
> because its more accurate and accuracy / reliability is the key"* (2026-11-13 16:09)

D8's keyword fallback was the planner's addition, not the user's. On a page with no curated
map, the extension now fills nothing and says so. `matchFields` and its tests are unchanged
(the keyword code stays for the web/WhatsApp paths); the gate is in the extension's route.

**(a)** `src/fieldmap.js`: find `function findCurated(url) {` → replace with
`export function findCurated(url) {`

**(b)** `src/web.js`: find
`import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs } from './fieldmap.js';`
→ replace with
`import { matchFields, operatorRefs, selectChains, hintRefs, verifyRefs, findCurated } from './fieldmap.js';`

**(c)** `src/web.js`: find
```js
  const profile = await getProfile(client);
  const values = matchFields({ profile, url, fields });
```
replace with
```js
  const profile = await getProfile(client);
  // A13 (R5): curated forms only. An uncurated page is never guessed at.
  if (!findCurated(url)) {
    return res.json({ curated: false, values: {}, operator: [], chains: [], hints: {}, verify: [], matched: 0, total: fields.length });
  }
  const values = matchFields({ profile, url, fields });
```

**(d)** `src/web.js`: find
`'pop_compress', 'pop_choose_client', 'pop_no_option', 'panel_verify_field',`
→ replace with
`'pop_compress', 'pop_choose_client', 'pop_no_option', 'panel_verify_field', 'pop_not_curated',`

**(e)** i18n — insert immediately after the `"panel_verify_field"` line in each file:
- en: `  "pop_not_curated": "This form is not curated yet, so nothing is filled automatically. Fill it by voice or typing (Alt+Shift+V).",`
- hi: `  "pop_not_curated": "यह फ़ॉर्म अभी क्यूरेट नहीं है, इसलिए अपने-आप कुछ नहीं भरा गया। इसे आवाज़ या टाइप करके भरें (Alt+Shift+V)।",`
- mr: `  "pop_not_curated": "हा फॉर्म अजून क्युरेट केलेला नाही, त्यामुळे आपोआप काहीही भरले नाही. आवाजाने किंवा टाइप करून भरा (Alt+Shift+V).",`

**(f)** `extension/content.js`: find
```js
    if (r.error || !r.values) return status(r.error || T('panel_fill_failed'), 'err');
```
replace with
```js
    if (r.error || !r.values) return status(r.error || T('panel_fill_failed'), 'err');
    // A13 (R5): curated forms only.
    if (r.curated === false) return status(T('pop_not_curated'), 'warn');
```

Verify:
```bash
npm test
node src/fieldmap.test.js | grep passed
node --check extension/content.js && node --check src/web.js && echo "ok"
node -e "for (const l of ['en','hi','mr']) { console.log(l, Object.keys(require('./src/i18n/'+l+'.json')).length) }"
```
Expected: 44, 28, 16, 19, 13, 9 passed; `34 passed, 0 failed`; `ok`; `en 84`, `hi 84`, `mr 84`.
Do not start, stop or restart anything.

---

## PART B — extension

Replaces the single persistent panel with one small pop-up per feature (R7). Reuses the
existing logic of `content.js` (API relay, `labelFor`, fill + chains + operator + hints, voice
recording, canvas conversion and compression, download) — moved, not redesigned.

### B1. Vendor files

```bash
mkdir -p extension/vendor
cp node_modules/pdfjs-dist/build/pdf.min.mjs extension/vendor/pdf.min.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs extension/vendor/pdf.worker.min.mjs
cp node_modules/pdf-lib/dist/pdf-lib.min.js extension/vendor/pdf-lib.min.js
```

### B2. `extension/manifest.json` — replace the whole file

```json
{
  "manifest_version": 3,
  "name": "GovTech Form Assistant",
  "version": "2.0.0",
  "description": "Validates documents and fills government forms from verified records. Never submits.",
  "permissions": ["activeTab", "scripting", "storage", "offscreen"],
  "host_permissions": ["http://localhost:3000/*", "<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["pick.js", "content.js"], "run_at": "document_idle" }],
  "commands": {
    "fill-form": { "suggested_key": { "default": "Ctrl+Shift+F" }, "description": "Fill the form from the client's documents" },
    "voice-chat": { "suggested_key": { "default": "Alt+Shift+V" }, "description": "Speak or type into the clicked field" },
    "change-format": { "suggested_key": { "default": "Alt+Shift+C" }, "description": "Change a file's format" },
    "compress": { "suggested_key": { "default": "Alt+Shift+Z" }, "description": "Compress a file to a size limit" },
    "pick-client": { "description": "Choose the client" }
  }
}
```

### B3. `extension/background.js` — replace the whole file

```js
// D13: all network calls go through this service worker. Phase 14: one command per feature
// (R7); PDF work is relayed to an offscreen document running pdf.js (R3).
const BASE = 'http://localhost:3000';

const FEATURE = {
  'fill-form': 'FILL',
  'voice-chat': 'VOICE',
  'change-format': 'FORMAT',
  'compress': 'COMPRESS',
  'pick-client': 'CLIENT',
};

chrome.commands.onCommand.addListener(async (command) => {
  const feature = FEATURE[command];
  if (!feature) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'FEATURE', feature }); } catch { /* no content script on this page */ }
  }
});

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Read and render PDF files with pdf.js for format conversion, compression and upload checks.',
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'PDF') {
    (async () => {
      try {
        await ensureOffscreen();
        const r = await chrome.runtime.sendMessage({ type: 'PDF_OFFSCREEN', op: msg.op, args: msg.args });
        sendResponse(r || { ok: false, error: 'no response from PDF worker' });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }

  if (msg.type !== 'API') return false;
  const { method, path, body, binary } = msg;
  (async () => {
    try {
      const res = await fetch(BASE + path, {
        method: method || 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (binary) {
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        sendResponse({ ok: res.ok, base64: btoa(s) });
        return;
      }
      sendResponse(await res.json());
    } catch {
      sendResponse({ ok: false, error: 'service not running' });
    }
  })();
  return true;
});
```

### B4. `extension/offscreen.html` — new

```html
<!doctype html>
<meta charset="utf-8">
<script src="vendor/pdf-lib.min.js"></script>
<script type="module" src="offscreen.js"></script>
```

### B5. `extension/offscreen.js` — new

```js
// Phase 14 (R3, R6, R1): PDF work with pdf.js, in an offscreen document so the pdf.js worker
// and <canvas> run at the extension's own origin on any portal page.
import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

const fromB64 = (b64) => Uint8Array.from(atob(String(b64).replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0));
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const open = (b64) => pdfjsLib.getDocument({ data: fromB64(b64) }).promise;

async function renderPage(pdf, n, scale, type, quality) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c.toDataURL(type, quality);
}

const OPS = {
  /** PDF -> plain text, pages separated by a blank line. */
  async text({ b64 }) {
    const pdf = await open(b64);
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      out.push(tc.items.map((x) => x.str).join(' '));
    }
    return { text: out.join('\n\n') };
  },
  /** PDF -> one image data URL per page (type image/png or image/jpeg). */
  async images({ b64, type, maxPages }) {
    const pdf = await open(b64);
    const n = Math.min(pdf.numPages, maxPages || pdf.numPages);
    const pages = [];
    for (let i = 1; i <= n; i++) pages.push(await renderPage(pdf, i, 2, type, 0.92));
    return { pages };
  },
  /**
   * Text -> PDF (R3, "pdf to text and vice versa"). Drawn on a canvas so Devanagari renders with
   * the system font (pdf-lib's standard fonts cannot encode it), then assembled as A4 pages.
   */
  async textToPdf({ text }) {
    const { PDFDocument } = window.PDFLib;
    const W = 1240, H = 1754, M = 100, LH = 34;          // A4 at 150 dpi
    const font = '22px "Nirmala UI", "Noto Sans Devanagari", sans-serif';
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.font = font;
    const lines = [];
    for (const para of String(text).replace(/
/g, '').split('
')) {
      let line = '';
      for (const word of para.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word;
        if (g.measureText(tryLine).width > W - 2 * M && line) { lines.push(line); line = word; }
        else line = tryLine;
      }
      lines.push(line);
    }
    const perPage = Math.floor((H - 2 * M) / LH);
    const doc = await PDFDocument.create();
    for (let start = 0; start < Math.max(lines.length, 1); start += perPage) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#000'; g.font = font; g.textBaseline = 'top';
      lines.slice(start, start + perPage).forEach((l, i) => g.fillText(l, M, M + i * LH));
      const img = await doc.embedJpg(fromB64(c.toDataURL('image/jpeg', 0.92)));
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return { pdf: toB64(await doc.save()) };
  },
  /** PDF -> smaller PDF: pages re-rendered as JPEG, stepping scale and quality down to the budget. */
  async compress({ b64, budgetKB }) {
    const pdf = await open(b64);
    const { PDFDocument } = window.PDFLib;
    const steps = [[1.5, 0.8], [1.2, 0.7], [1.0, 0.6], [0.8, 0.5], [0.6, 0.4]];
    for (let s = 0; s < steps.length; s++) {
      const [scale, q] = steps[s];
      const doc = await PDFDocument.create();
      for (let i = 1; i <= pdf.numPages; i++) {
        const img = await doc.embedJpg(fromB64(await renderPage(pdf, i, scale, 'image/jpeg', q)));
        const p = doc.addPage([img.width, img.height]);
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await doc.save();
      if (bytes.length <= budgetKB * 1024 || s === steps.length - 1) {
        return { pdf: toB64(bytes), kb: Math.round(bytes.length / 1024) };
      }
    }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'PDF_OFFSCREEN' || !OPS[msg.op]) return false;
  (async () => {
    try { sendResponse({ ok: true, ...(await OPS[msg.op](msg.args || {})) }); }
    catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
  })();
  return true;
});
```

### B6. `extension/content.js` — rewrite as bottom pop-ups

Replace the whole file. Keep the header comment
`// Form assistant. One keybind per feature, each in a small pop-up from the bottom (R7). Never submits anything (D11). All fetches go via background.js (D13).`
and wrap everything in the existing `if (window.__govtechPanel) return; window.__govtechPanel = true;` IIFE.

**Carry over unchanged from the current file** (copy the code, do not rewrite it):
`api(...)`; the `focusin` tracker of `lastFocused`; `labelFor(el)`; the whole body of the current
fill handler from `const els = [...document.querySelectorAll(...)]` through the end of the dropdown
`chains` loop (values loop with the SELECT/readOnly/disabled skip, Phase 9 operator loop, Phase 10
hints loop, Phase 10 chains loop); the `MediaRecorder` recording code; the canvas image
convert/compress loop; `download(blob, name)`.

**Add** these helpers:
```js
const pdf = (op, args) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: 'PDF', op, args }, (r) => resolve(r || { ok: false, error: 'no response' }));
});
const readDataUrl = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
const dataUrlToBlob = (u) => { const [h, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.slice(5).split(';')[0] }); };
const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
const baseName = (f) => f.name.replace(/\.[^.]+$/, '');
```

**Pop-up shell** (one host element, shadow DOM, one pop-up visible at a time):
- Host: `all:initial; position:fixed; left:0; right:0; bottom:0; z-index:2147483647; pointer-events:none;` appended to `document.documentElement`.
- Pop-up box `.pop`: `pointer-events:auto; position:absolute; left:50%; bottom:24px; width:min(560px, calc(100vw - 32px)); max-height:60vh; overflow:auto; box-sizing:border-box; background:#fff; color:#111; border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,.28); padding:14px 16px; font:14px system-ui,'Nirmala UI',sans-serif;`
- Open animation: from `transform:translate(-50%,120%); opacity:0` to `transform:translate(-50%,0); opacity:1` over 180 ms (`transition`). Close: reverse, then `display:none`.
- No overlay. The page stays fully usable while a pop-up is open.
- **Header row:** title (bold, flex 1) · language `<select>` (en / हिंदी / मराठी, remembered in `chrome.storage.local` key `lang`) · client `<select>` (first option value `''` text `—`; options from `/api/clients`, each `name` plus ` (incomplete)` text from `T('panel_incomplete')` when `!ready`; remembered in key `client`; keep the selection when reloaded) · `✕` button.
- **Body** `div` (feature content) and **status** line `div` (classes `err` red `#b00020`, `okc` green `#0a7d2c`, `warn` amber `#a15c00`).
- `✕` and **Esc** (document `keydown` listener in capture phase, only while open) close the pop-up.
- `openPopup(feature, titleKey)` shows the shell, sets the title from `T(titleKey)`, clears body and status, cancels any pending auto-close, and remembers `currentFeature`.
- `autoClose(ms)` closes after `ms` unless another pop-up was opened since.
- Strings: `/api/strings?lang=` loaded on first open and when the language changes; `T(key)` as today.
- Changing the language reloads strings, re-renders the title, and re-runs FILL if FILL is the current feature.
- Changing the client stores it, and if the current feature is FILL, runs FILL (auto-validate + fill on pick — PS "automated", D5).

**Message listener:** `chrome.runtime.onMessage` on `{ type: 'FEATURE', feature }` → call the
matching feature function below.

**FILL** (title `panel_fill`):
1. Ensure strings and clients are loaded; restore remembered `lang` and `client`.
2. If no client is selected: status `pop_choose_client` (warn) and stop. (Choosing one runs FILL.)
3. Validate: `GET /api/clients/<client>/validate?lang=` and render, in the body, the same lines
   the current validate handler renders: `all_clear` (okc) when `r.ok`; each `r.errors[].message`
   (err); `r.missing_message` (err); each `r.notices[].message` (warn).
4. Fill: run the carried-over fill code. After the hints loop and **before** the chains loop, add:
   ```js
   // Phase 14 (ADR-8): filled, but possibly a machine transliteration — operator checks it.
   let toCheck = 0;
   for (const ref of r.verify || []) {
     const el = refs.get(ref);
     if (!el || !el.value) continue;
     el.style.outline = '3px dashed #e69500';
     el.title = T('panel_verify_field');
     toCheck++;
   }
   ```
5. Status: if `r.matched + picked === 0` → `panel_fill_nothing` (err). Otherwise
   `T('pop_summary')` with `{n}` = `r.matched + picked`, `{o}` = `(r.operator || []).length`,
   `{c}` = `toCheck` (okc).
6. If there are no errors and no missing documents → `autoClose(6000)`. Otherwise stay open.

**VOICE** (title `panel_voice`) — R2, D6, D7:
1. Target = `lastFocused` if it is still in the document, else `document.activeElement` if it is an
   `input`, `textarea` or `select`. If none: status `panel_click_field` (err) and stop.
2. Body: target's `labelFor(target)` (bold), then a `textarea` (3 rows), a Record/Stop button
   (`panel_record` / `panel_stop`), and an Insert button (`panel_insert`).
3. Recording starts immediately on open (status `pop_listening`, warn). Stop → POST `/api/stt`
   `{ audioBase64, lang }` → put `r.text` in the textarea and focus it; on failure status
   `voice_empty` (err). The textarea can also simply be typed into (the chat path).
4. **Enter** (without Shift) in the textarea, or Insert → write to the target **only now**
   (confirmation, D6):
   - `input` / `textarea`: set `value`, dispatch `input` and `change` (bubbles), outline `2px solid #0a7d2c`.
   - `select`: `window.__govtechPick.pickOption(options, { mode: 'oneOf', candidates: [text] })`,
     else `{ mode: 'within', source: text }`; if a value is found set it, dispatch `change`, outline green;
     if none, status `pop_no_option` (err) and do not close.
   Then status `panel_inserted` (okc) and `autoClose(800)`.
5. Esc closes without inserting.

**FORMAT** (title `panel_format`) — R3:
1. Body: a file input (`accept="image/*,application/pdf,text/plain,.txt"`), a target `<select>`, and a Convert button (`pop_convert`).
   If the pop-up was opened with a preloaded file (see upload capture), use it.
2. Target options, rebuilt when the file changes:
   - image file: `JPEG` (image/jpeg), `PNG` (image/png), `WEBP` (image/webp), `PDF` (pdf)
   - PDF file: `T('pop_to_text')` (txt), `PNG · ` + `T('pop_to_pages')` (png-pages), `JPEG · ` + `T('pop_to_pages')` (jpeg-pages)
   - text file (`text/plain` or `.txt`): `PDF` (txt-pdf)
3. Convert:
   - image → JPEG/PNG/WEBP: draw on a canvas at natural size, `toBlob(type, 0.92)`, download `<base>.<ext>` (`jpg`, `png`, `webp`).
   - image → PDF: the current `/api/to-pdf` path (JPEG via canvas, `binary: true`), download `<base>.pdf`.
   - PDF → txt: `pdf('text', { b64 })`, download `<base>.txt` as `text/plain;charset=utf-8`.
   - PDF → png-pages / jpeg-pages: `pdf('images', { b64, type })`, download each page as `<base>-p<N>.png|jpg`.
   - text → PDF: read the file as UTF-8 text, `pdf('textToPdf', { text })`, download `<base>.pdf`.
   - Any failure: status `panel_pdf_failed` (err).
4. Success: status `panel_done_kb` with `{n}` = total KB downloaded (okc), then `autoClose(3000)`.

**COMPRESS** (title `pop_compress`) — R6:
1. Body: a file input (`accept="image/*,application/pdf"`), max size number input (label `panel_maxsize`, default `200`), and a Compress button (`pop_compress`). Preloaded file as in FORMAT.
2. Image: the carried-over canvas quality-stepping loop. JPEG and WEBP keep their type; anything
   else becomes JPEG. Download `<base>-compressed.<ext>`.
3. PDF: `pdf('compress', { b64, budgetKB })`, download `<base>-compressed.pdf`.
4. Success: status `panel_done_kb` (okc), `autoClose(3000)`. Failure: `panel_pdf_failed` (err).

**CLIENT** (title `panel_client`): body is only the header's client select (focus it); choosing
a client stores it, status `panel_inserted`-style confirmation is **not** shown — just `autoClose(800)`.

**UPLOAD CAPTURE** (title `pop_upload`) — R1, automatic, no key:
1. `document.addEventListener('change', handler, true)`. Act only when `e.target` is an
   `input[type=file]` with at least one file. Never call `preventDefault` — the upload proceeds.
2. For the first file `f`: `openPopup('UPLOAD', 'pop_upload')`, status `upload_checking` with `{f}` = file name (warn).
3. Format check from the input's `accept` attribute (comma-separated MIME types, `type/*`
   wildcards and `.ext` extensions; empty `accept` = anything). If `f` does not match, add an err
   line `upload_format_bad` with `{f}` = name, `{t}` = upper-case extension, `{a}` = the `accept` value.
4. Image to send: PDF → `pdf('images', { b64, type: 'image/jpeg', maxPages: 1 })` and use `pages[0]`;
   image → `readDataUrl(f)`.
5. `POST /api/check-upload` with `{ client: <selected client or ''>, label: labelFor(input) + ' ' + (input.name || '') + ' ' + (input.id || ''), fileName: f.name, imageBase64, lang }`.
6. Render: if `r.docName`, a line `r.docName` (bold); each `r.errors[].message` (err); each
   `r.notices[].message` (warn); `r.okMessage` (okc) when `r.ok`. If `r.error`: status `r.error` (err).
7. Always add two buttons: Convert (`pop_convert`) → opens FORMAT with `f` preloaded; Compress
   (`pop_compress`) → opens COMPRESS with `f` preloaded.
8. Clear the status. If `r.ok` and no format error → `autoClose(8000)`; otherwise stay open.

**Never submit (D11):** no code may call `.submit()`, `requestSubmit()`, or `.click()` on any
page element. The only `.click()` allowed is on the temporary `<a>` used by `download`.

### B7. Verify Part B

```bash
node --check extension/content.js && node --check extension/background.js && node --check extension/offscreen.js && node --check extension/pick.js && echo "js ok"
node -e "const m=JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8'));console.log(Object.keys(m.commands).join(','), m.permissions.includes('offscreen'))"
ls extension/vendor
grep -nE "\.submit\(|requestSubmit|preventDefault" extension/content.js || echo "no submit"
grep -c "\.click()" extension/content.js
```
Expected: `js ok`; `fill-form,voice-chat,change-format,compress,pick-client true`;
`pdf-lib.min.js  pdf.min.mjs  pdf.worker.min.mjs`; `no submit`; `1`.
Note: `node --check` cannot parse `offscreen.js` if Node rejects the `import` without
`"type":"module"` context — if so, run `node --check --input-type=module < extension/offscreen.js`
instead and report which form was used.

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
