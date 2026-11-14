# SarkarSathi AI — PS 19: AI Government Form & Document Verification Assistant

A tool for Common Service Centre (CSC) operators who fill government forms for citizens.
It has two independent features:

1. **Multilingual voice and chat form filling.** Click any field on a government portal, press a
   key, speak or type in English, Hindi or Marathi, check the text, and it goes into the field.
   It needs no documents.
2. **Automated pre-submission OCR validation.** When a document is picked in the portal's upload
   slot, a local vision model reads it and a rule-based validator (no AI makes the decision)
   checks it, so problems are caught before the portal rejects the application.

Extras: fill a form from a citizen's stored documents, change file formats, compress files to an
upload limit. The tool never presses Submit; the operator does.

## How it fits the PS

| PS asks for | What does it |
|---|---|
| Multilingual | Every message and pop-up in English, Hindi and Marathi |
| Voice-and-chat form filling | Alt+Shift+V pop-up: speak or type into the clicked field, confirm, inserted |
| Automated pre-submission OCR validation | Upload capture: each document is read and checked the moment it is picked |
| Aadhaar, income certificates, land records | All three are read; the 7/12 land record is read in Marathi |

| PS revenue stream | What exists |
|---|---|
| API usage charges for document verification | Every verification call needs a CSC API key and is counted per key per day |
| Per-application processing fees | Each form filled is counted per key |
| CSC operator subscriptions | One key per CSC; the SarkarSathi Desk shows that CSC's usage in rupees |
| B2G portal licensing | The verification API can be called by a portal's own upload slot |

The Desk turns usage into money at demo rates: Rs 2 per document verified, Rs 10 per application
filled, other actions included (`src/keys.js`). Payment and billing are not built; this is a
usage tracker for the pitch.

## Start it

**One click:** double-click `desktop\SarkarSathi.vbs`. A tray app starts the AI (Ollama), the voice
service and the server if they are not already running, and opens the SarkarSathi Desk.
**Alt+Shift+D** shows or hides the Desk.

**Manual:** three commands, each in its own terminal:

```bash
ollama serve            # model: qwen3-vl:4b-instruct; skip if Ollama is already running
python stt/server.py    # voice service
npm start               # server on http://localhost:3000
```

Copy `.env.example` to `.env` and set `USE_MOCK=false` and `USE_MOCK_STT=false`.

## Chrome extension

1. Open `chrome://extensions`, turn on Developer mode, and load the unpacked `extension/` folder
   (or reload it after changes).
2. Open the extension's **Options** page and enter the server address and your CSC key.
3. Check `chrome://extensions/shortcuts`: a key may be unassigned if another extension holds it.

## Keys

| Key | What it does |
|---|---|
| Alt+Shift+V | Voice or chat into the field you clicked |
| Alt+Shift+C | Change format both ways: JPEG, PNG, WEBP, image and PDF, text and PDF |
| Alt+Shift+Z | Compress an image or PDF to a size limit |
| Ctrl+Shift+F | Fill the form from the citizen's stored documents (extra) |
| client picker | Choose the citizen; no default key, assign one on the shortcuts page |
| Alt+Shift+D | Show or hide the SarkarSathi Desk (from the tray app) |

Upload capture needs no key: a file picked in an upload slot is read and checked on the spot.

## CSC keys and usage

```bash
npm run key -- "CSC name"
```

This creates a key for one CSC. Keys and usage are stored in `keys/`, which is not committed.
Sign in to the Desk with the key to see today's and this month's usage in rupees.

## Forms

Only set-up (curated) forms are filled automatically, because accuracy matters more than coverage:

- Aaple Sarkar EWS 10% Self-Declaration (`forms/mahaonline-ews.json`)
- the demo copy at http://localhost:3000/portal-ews.html

District, taluka, village and gender dropdowns are matched by their codes, so the page's language
or the browser's translation does not break them. On other pages, fill by voice or chat.
New forms can be mapped with `tools/form-scan.js` (see `tools/README.md`).

## Documents (optional, for the fill extra)

Put each citizen's images in `MASTER/ADHAAR`, `MASTER/INCOME CERTIFICATE` and
`MASTER/LAND RECORDS`, with the same file name in each. The folders are watched, so no restart is
needed. `MASTER/` is not committed.

## Privacy

- Documents are processed on this machine by local models.
- Only the last 4 digits of an Aadhaar number are kept; voice logs mask 12-digit numbers.
- Citizen documents (`MASTER/`), keys and `.env` are not committed.

## Tests

```bash
npm test
node src/fieldmap.test.js
```

## Known limits

- The Hindi and Marathi messages still need proofreading by a native reader.
- One real government form is curated so far.
- Voice can drop a repeated digit in a PIN or mishear an English place name. Every transcript is
  shown and confirmed before it goes into a field.

## Legacy surfaces (fallback)

The sections below describe the earlier web page, voice setup, WhatsApp bot and file ownership.

> **New here? Read [HANDOFF.md](HANDOFF.md) first.** It holds the current state, every
> known defect, the environment traps that cost hours, and what is still unproven.
> `govtech_whatsapp_assistant_builder_agent_blueprint.md` is **superseded** — it was
> written by an agent that overrode the team's architecture and invented requirements.

WhatsApp bot. Citizen sends three documents, local AI reads them, the rulebook
cross-checks them **against each other**, and a filled EWS form comes back as a PDF.

Everything below runs **with no AI and no WhatsApp account**, so nobody is blocked.

### Start here (2 minutes)

```bash
npm install
cp .env.example .env
npm run test:rules
```

`test:rules` exercises the entire validation engine against fixtures. If it passes,
Layer 2 works and Dev 4 has a full day of work available with zero dependencies.

Generate the output PDF and open it:

```bash
npm run test:pdf
```

Run the whole pipeline end to end with mocked extraction:

```bash
npm run dev
curl -X POST http://localhost:3000/dev/run
```

### Web surface (ADR-5 fallback)

```bash
npm start
```
Then open http://localhost:3000 — upload three documents, watch validation, correct any
field, download the form. Tick **Use demo fixtures** to run it with no photos and no model.

This is pure transport: `src/web.js` calls the same extractor, rulebook and PDF generator
as the WhatsApp path. It adds no rules of its own, and nothing here needs removing if the
WhatsApp transport lands later.

`POST /api/pdf` re-runs validation server-side, so the page cannot bypass the rulebook.

### Voice (B10)

Separate local service, same pattern as Ollama — keeps the model resident so Node never
pays the load cost per request.

```bash
python -m pip install -r stt/requirements.txt
python stt/server.py
```

**Use the requirements file, not `pip install faster-whisper`.** A plain install pulls
PyAV 19, which breaks every transcription with `metadata_errors` — and the service still
reports healthy, so you only find out on the first real voice note.

First run downloads Whisper `small` (~500 MB). Then set `USE_MOCK_STT=false` in `.env`.

It accepts WhatsApp's OGG/Opus **directly** — faster-whisper bundles PyAV, so no separate
ffmpeg install is needed on Windows.

Transcripts are routed through the same handler as typed text, so voice can never drift
out of sync with chat. Spoken corrections ("name is Ramesh Patil") are mapped onto the
numeric review protocol by keyword, not by an LLM — it has to behave identically every time.

```bash
node src/stt.test.js    # 16 tests, needs no audio and no model
```

### Who owns what

| File | Owner | Blocked by |
|---|---|---|
| `src/extractor.js` | Dev 1 | needs Ollama — **start `ollama pull qwen2-vl:7b` now** |
| `src/server.js`, `src/session.js` | Dev 2 | nothing |
| `src/whatsapp.js`, `src/i18n/*` | Dev 3 | needs Meta app — **create it now** |
| `src/rulebook.js`, `src/pdf.js` | Dev 4 | nothing |

Only two tracks have external wait time. Start those downloads and accounts first;
everything else is offline work.

### The mock switch

`.env` has `USE_MOCK=true`. Extraction returns `fixtures/*.json` instantly, so the
pipeline is fully testable before the vision model exists.

When Dev 1's model is ready, set `USE_MOCK=false`. Nothing else changes.

### Architecture

**Layer 1 — Extract** (`extractor.js`) · photo → JSON. The AI does not know which
form the user wants; it only reports what is on the document.

**Layer 2 — Validate** (`rulebook.js`) · pure JavaScript, no AI. Name matching across
documents, date recency, income ceiling. Deterministic, so it never surprises you on stage.

**Layer 3 — Fill** (`pdf.js`) · ask for whatever is still missing, then generate the PDF.

Adding a second government form later means writing a new Layer 2 rulebook only.
That is the answer when a judge asks whether it scales past one form.

### Connecting WhatsApp (Dev 3)

1. Meta Developer Dashboard → create app → add WhatsApp product
2. Add all 4 team SIMs to the allowlist (sandbox caps at 5 numbers)
3. Copy the temporary token and Phone Number ID into `.env`
4. Expose the server: `npx ngrok http 3000`
5. Webhook URL = `https://<ngrok-url>/webhook`, verify token = whatever is in `.env`
6. Subscribe to the **messages** field

The token expires in 24 hours. Regenerate it immediately before the pitch.

### Three things that will break the demo

**Never move the `res.sendStatus(200)` line** in `src/server.js`. Inference takes
10–40s. Hold the webhook open and Meta retries, processing the same photo repeatedly.

**Media URLs expire in 5 minutes.** `downloadMedia` is called the instant the webhook
arrives, before any AI work. Keep it that way.

**Test extraction on real document photos early.** Small vision models struggle with
Marathi 7/12 tables. Find that out at hour 5, not hour 18.

### Demo script

1. Send `hi` → language buttons → pick **मराठी**
2. Send Aadhaar photo → bot reads it, replies in Marathi
3. Send Income Certificate
4. Send the **7/12 with the planted name mismatch** (`fixtures/land_mismatch.json`)
5. **Bot catches it and explains the problem in Marathi** ← this is the pitch
6. Send the correct 7/12, answer the purpose question
7. Filled EWS PDF arrives on the phone

Step 5 is the whole product in ten seconds. Rehearse it on the real phone by hour 21.

### Cut list, in order

1. Drop Marathi, English only (costs nothing in the demo)
2. Skip voice input entirely
3. Skip the language picker, hardcode English

**Never cut:** photo → extract → cross-check → PDF. That spine is the product.
