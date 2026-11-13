# Execution Plan — strictly execute, do not design

**Audience:** a builder subagent.
**Status of decisions:** all made. None are delegated to you.

> **EXECUTED AND COMPLETE — 2026-11-13.** All seven tasks are done; `npm test` reports
> 97 passing. This file is kept as a record of how the work was specified, not as
> outstanding work. Do not re-run it.
>
> Two defects were found in this plan during execution, both in Task 4's test, and both
> have been corrected in `src/simulate.test.js`:
> 1. The review-stage checks ran one step too early. The purpose question is asked after
>    the third document; the review summary only follows the purpose answer.
> 2. The deduplication check drove `handleMessage`, but `alreadyProcessed()` is called by
>    the webhook route in `server.js`, not by `handleMessage`. It is now tested at its own
>    layer.
>
> The executing agent stopped at the first mismatch and reported rather than patching the
> test, which is exactly correct — the defects were in the plan, not the code.

---

## 0. Rules for the executing agent

1. **Make no design decisions.** Every file path, function name, algorithm, string and
   constant below is already chosen. Type what is specified.
2. **Do not substitute approaches.** If a step says "use X", do not use Y because Y seems
   better. A previous agent silently replaced a chosen architecture and cost the team
   hours. See ADR-1 in `BUILD_SPEC.md`.
3. **Do not add features.** No extra endpoints, no refactors, no renames, no dependency
   additions, no "while I was here" cleanups.
4. **Verify after every task.** Each task ends with a command and an expected output.
   Run it. Compare it.
5. **On any mismatch, STOP and report.** Do not improvise a fix, do not continue to the
   next task. Report: the task number, the command, the expected output, the actual
   output.
6. **If a step is ambiguous, STOP and ask.** Ambiguity is a defect in this plan, not an
   invitation to choose.
7. **Never weaken a test to make it pass.** If a test fails, the code is wrong, not the
   test.
8. Work in order. Task N assumes Task N-1 succeeded.

### Preconditions — verify before starting

```bash
cd "C:\Users\gurav\Desktop\vaij d grt"
node src/rulebook.test.js | grep passed
node src/review.test.js   | grep passed
node src/stt.test.js      | grep passed
node src/i18n.test.js     | grep passed
```

Expected, exactly:
```
21 passed, 0 failed
28 passed, 0 failed
16 passed, 0 failed
19 passed, 0 failed
```

If any number differs, STOP. The repository is not in the state this plan assumes.

---

## TASK 1 — Make `server.js` importable without starting a listener

**Why:** the simulator imports `handleMessage`. Importing `server.js` today calls
`app.listen` and binds port 3000.

### 1.1 Edit `src/server.js`

Find:
```js
async function handleMessage(message) {
```
Replace with:
```js
export async function handleMessage(message) {
```

### 1.2 Edit `src/server.js`

Find:
```js
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
```
Replace with:
```js
const PORT = process.env.PORT || 3000;

// Only listen when run directly. Importing this module (e.g. from src/simulate.js)
// must not bind a port.
if (process.env.NO_LISTEN !== 'true') {
app.listen(PORT, () => {
```

### 1.3 Edit `src/server.js`

Find the closing of that listen callback — the last three lines of the file:
```js
  console.log(`  Try: curl -X POST http://localhost:${PORT}/dev/run\n`);
});
```
Replace with:
```js
  console.log(`  Try: curl -X POST http://localhost:${PORT}/dev/run\n`);
});
}
```

### Verify

```bash
NO_LISTEN=true node -e "import('./src/server.js').then(m=>console.log(typeof m.handleMessage))"
```
Expected output, exactly:
```
function
```

---

## TASK 2 — Let the mock extractor select a fixture

**Why:** the simulator must feed the planted-mismatch land record. Decision: an env var
per document type, named `MOCK_<TYPE>`, holding a fixture basename.

### 2.1 Edit `src/extractor.js`

Find:
```js
  if (USE_MOCK) {
    const file = path.join(process.cwd(), 'fixtures', `${docType}.json`);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
```
Replace with:
```js
  if (USE_MOCK) {
    // MOCK_IDENTITY / MOCK_INCOME / MOCK_LAND override which fixture is returned,
    // so a simulated run can feed the planted-mismatch record. Default is the
    // fixture named after the document type.
    const override = process.env[`MOCK_${docType.toUpperCase()}`];
    const basename = override || docType;
    const file = path.join(process.cwd(), 'fixtures', `${basename}.json`);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
```

### Verify

```bash
USE_MOCK=true MOCK_LAND=land_mismatch node -e "import('./src/extractor.js').then(async m=>{const r=await m.extractDocument(Buffer.from(''),'land');console.log(r.owner_names_latin[0])})"
```
Expected output, exactly:
```
Ramesh Shankar Pawar
```

---

## TASK 3 — Create the conversation simulator

**Why:** `src/server.js` has no test coverage, and the full flow cannot be exercised
without a Meta account. This also satisfies ADR-5's hour-12 fallback: the product stays
demonstrable if WhatsApp never lands.

### 3.1 Create `src/simulate.js`

Create the file with exactly this content:

```js
// Drives the whole conversation with synthetic WhatsApp webhook payloads.
// No Meta account, no ngrok, no network, no AI.
//
//   node src/simulate.js          happy path
//   node src/simulate.js mismatch planted name mismatch (the demo case)
//   node src/simulate.js hi       happy path in Hindi
//
// Env is set before any import because extractor.js and stt.js read their mock flags
// at module load time.

process.env.DRY_RUN = 'true';
process.env.USE_MOCK = 'true';
process.env.USE_MOCK_STT = 'true';
process.env.NO_LISTEN = 'true';

const mode = process.argv[2] || 'happy';
if (mode === 'mismatch') process.env.MOCK_LAND = 'land_mismatch';
const language = mode === 'hi' ? 'hi' : 'mr';

const { handleMessage } = await import('./server.js');
const { getOutbox, clearOutbox } = await import('./whatsapp.js');

const FROM = '919999999999';
let seq = 0;
const id = () => `wamid.sim${++seq}`;

const text = (body) => ({ from: FROM, id: id(), type: 'text', text: { body } });
const button = (buttonId) => ({
  from: FROM, id: id(), type: 'interactive',
  interactive: { button_reply: { id: buttonId } },
});
const image = () => ({ from: FROM, id: id(), type: 'image', image: { id: `media${seq}` } });
const audio = () => ({ from: FROM, id: id(), type: 'audio', audio: { id: `media${seq}` } });

function render(label) {
  const messages = getOutbox();
  if (label) console.log(`\n\x1b[36m>>> USER: ${label}\x1b[0m`);
  for (const m of messages) {
    if (m.type === 'text') console.log(`    BOT: ${m.text.body}`);
    else if (m.type === 'document') console.log(`    BOT: [PDF ${m.document.filename}, ${m.document.bytes} bytes]`);
    else if (m.type === 'interactive') {
      const titles = m.interactive.action.buttons.map((b) => b.reply.title).join(' | ');
      console.log(`    BOT: ${m.interactive.body.text}  [${titles}]`);
    }
  }
  clearOutbox();
}

async function step(label, message) {
  await handleMessage(message);
  render(label);
}

console.log(`\n=== SIMULATION: ${mode} ===`);

await step('hi', text('hi'));
await step(`(taps ${language})`, button(`lang_${language}`));
await step('[photo of Aadhaar]', image());
await step('[photo of Income Certificate]', image());
await step('[photo of 7/12 extract]', image());

if (mode === 'mismatch') {
  console.log('\n\x1b[33m--- validation stopped the flow above. Nothing was generated. ---\x1b[0m');
  console.log('=== END ===\n');
  process.exit(0);
}

await step('School admission', text('School admission'));
await step('1 Ramesh Shankar Patil', text('1 Ramesh Shankar Patil'));
await step('[voice note]', audio());

console.log('=== END ===\n');
process.exit(0);
```

### Verify

```bash
node src/simulate.js
```

Expected: a printed conversation that ends with a `[PDF EWS_Application.pdf, NNNN bytes]`
line. The byte count will vary; its presence must not.

```bash
node src/simulate.js mismatch
```

Expected: the conversation stops after the third photo with a name-mismatch message in
Marathi, and **no PDF line appears**. If a PDF is produced in `mismatch` mode, STOP and
report — that is the core guarantee of this product failing.

---

## TASK 4 — Add the simulator as a test

### 4.1 Create `src/simulate.test.js`

```js
// Run: node src/simulate.test.js
// Asserts the orchestration, not just that it runs.
process.env.DRY_RUN = 'true';
process.env.USE_MOCK = 'true';
process.env.USE_MOCK_STT = 'true';
process.env.NO_LISTEN = 'true';

const { handleMessage } = await import('./server.js');
const { getOutbox, clearOutbox } = await import('./whatsapp.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

let seq = 0;
const FROM = () => `9199${String(seq).padStart(8, '0')}`;
const mk = (from, type, extra) => ({ from, id: `wamid.t${++seq}`, type, ...extra });

const bodies = () => getOutbox().filter((m) => m.type === 'text').map((m) => m.text.body);
const hasDoc = () => getOutbox().some((m) => m.type === 'document');

async function runFlow(from, { land = 'land', lang = 'mr' } = {}) {
  process.env.MOCK_LAND = land;
  clearOutbox();
  await handleMessage(mk(from, 'text', { text: { body: 'hi' } }));
  await handleMessage(mk(from, 'interactive', { interactive: { button_reply: { id: `lang_${lang}` } } }));
  for (let i = 0; i < 3; i++) {
    await handleMessage(mk(from, 'image', { image: { id: `m${seq}` } }));
  }
}

console.log('\nHappy path');
seq = 100;
let who = FROM();
await runFlow(who);
check('reaches the review stage', bodies().some((b) => b.includes('तपशील')));
check('no PDF before confirmation', !hasDoc());

clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: 'School admission' } }));
check('asks nothing further once purpose is given', bodies().length > 0);

clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: 'ok' } }));
check('PDF delivered after confirmation', hasDoc());

console.log('\nPlanted mismatch');
seq = 200;
who = FROM();
await runFlow(who, { land: 'land_mismatch' });
check('mismatch reported', bodies().some((b) => b.includes('जुळत नाही')));
check('NO PDF generated', !hasDoc());

console.log('\nCorrection before generation');
seq = 300;
who = FROM();
await runFlow(who);
await handleMessage(mk(who, 'text', { text: { body: 'School admission' } }));
clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: '1 Corrected Name' } }));
check('correction echoed', bodies().some((b) => b.includes('Corrected Name')));
check('still no PDF after a correction', !hasDoc());

console.log('\nDeduplication');
seq = 400;
who = FROM();
clearOutbox();
const dup = mk(who, 'text', { text: { body: 'hi' } });
await handleMessage(dup);
const firstCount = getOutbox().length;
await handleMessage(dup);
check('repeated message id ignored', getOutbox().length === firstCount);

console.log('\nLanguage selection');
seq = 500;
who = FROM();
await runFlow(who, { lang: 'hi' });
check('replies in Hindi', bodies().some((b) => b.includes('विवरण')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
```

### Verify

```bash
node src/simulate.test.js | grep passed
```
Expected, exactly:
```
10 passed, 0 failed
```

If any check fails, STOP and report the failing check name.

> **Note on the deduplication check:** `alreadyProcessed` is module-level state shared
> across the run. The test uses a distinct `from` and message id per section for that
> reason. Do not "fix" this by resetting module state.

---

## TASK 5 — Add a one-command extraction tester

**Why:** G1 (can the VLM read real documents?) is the project's largest open risk and
needs to be answerable in one command by anyone on the team.

### 5.1 Create `src/extract.cli.js`

```js
// Run the REAL vision model against a real photograph.
//
//   node src/extract.cli.js identity path/to/aadhaar.jpg
//   node src/extract.cli.js land     path/to/712.jpg
//   node src/extract.cli.js income   path/to/income.jpg
//
// Requires Ollama running with qwen3-vl:4b-instruct pulled.

process.env.USE_MOCK = 'false';

import fs from 'node:fs/promises';
const { extractDocument } = await import('./extractor.js');

const [docType, imagePath] = process.argv.slice(2);

if (!docType || !imagePath) {
  console.error('Usage: node src/extract.cli.js <identity|income|land> <image-path>');
  process.exit(1);
}

const buffer = await fs.readFile(imagePath);
console.log(`Sending ${buffer.length} bytes to ${process.env.VLM_MODEL || 'qwen3-vl:4b-instruct'}...`);

const t0 = Date.now();
try {
  const result = await extractDocument(buffer, docType);
  console.log(`\nExtracted in ${((Date.now() - t0) / 1000).toFixed(1)}s:\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`\nFAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
  process.exit(1);
}
```

### Verify

```bash
node src/extract.cli.js
```
Expected output, exactly:
```
Usage: node src/extract.cli.js <identity|income|land> <image-path>
```

Do **not** attempt a run against a real image unless one has been supplied to you. If no
image exists, this task is complete at the usage check.

---

## TASK 6 — Register the new tests

### 6.1 Edit `package.json`

Find:
```json
    "test:rules": "node src/rulebook.test.js",
    "test:pdf": "node src/pdf.test.js"
```
Replace with:
```json
    "test:rules": "node src/rulebook.test.js",
    "test:pdf": "node src/pdf.test.js",
    "test": "node src/rulebook.test.js && node src/review.test.js && node src/stt.test.js && node src/i18n.test.js && node src/simulate.test.js",
    "sim": "node src/simulate.js",
    "sim:mismatch": "node src/simulate.js mismatch"
```

### Verify

```bash
npm test 2>&1 | grep -c "0 failed"
```
Expected output, exactly:
```
5
```

---

## TASK 7 — Final state report

Run and paste the complete output:

```bash
npm test 2>&1 | grep passed
node src/simulate.js mismatch
```

Then STOP. Do not proceed to WhatsApp integration, do not touch `src/whatsapp.js`, and do
not start any server.

---

## Explicitly out of scope

Do not do any of these, even if they seem necessary:

- Touching the Meta/WhatsApp transport (`src/whatsapp.js` beyond what Task 3 reads)
- Changing any prompt or JSON schema in `src/extractor.js`
- Changing thresholds in `src/rulebook.js` (0.75 similarity, ₹8,00,000, 12 and 6 months)
- Adding a fourth language
- Swapping the Whisper model size (see ADR-10: medium is 70× slower and worse)
- Installing any npm or pip package
- Reformatting, renaming or refactoring existing files
- Committing to git

## If you get stuck

Report in this format and stop:

```
TASK: <number>
COMMAND: <what you ran>
EXPECTED: <from this plan>
ACTUAL: <what happened>
```
