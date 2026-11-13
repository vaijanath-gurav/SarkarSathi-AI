# Build Specification — PS 19: AI Government Form & Document Verification Assistant

**For:** builder agent
**Context:** 24-hour hackathon. ~19 hours remaining at time of writing.
**Status:** this document supersedes `govtech_whatsapp_assistant_builder_agent_blueprint.md`.

> **Partly superseded itself.** The product later pivoted from a WhatsApp-first citizen
> tool to a CSC-operator tool: a local service plus a Chrome extension filling government
> portal forms from verified documents. See `BUILD_PLAN_EXTENSION.md` (D1–D15) for the
> current architecture and `HANDOFF.md` for state and known defects.
>
> **Still authoritative here:** ADR-1 (VLM over OCR), ADR-2 (deterministic rulebook, not
> an LLM), ADR-3 (pre-written i18n catalogs), ADR-8 (script handling), ADR-9 (review
> before generation), ADR-10 (voice limits). The rulebook, schemas, prompts and language
> handling are unchanged by the pivot. The WhatsApp transport in ADR-5 is now a fallback
> surface rather than the primary one.

Read Section 1 before writing any code. It records decisions that have already been
made, including one that a previous agent silently overrode. **Do not re-decide these.
If you believe a decision is wrong, say so and stop — do not substitute your own.**

---

## 1. Architecture Decision Record

### ADR-1: Vision-Language Model for extraction — NOT OCR + text LLM

**Decided:** single VLM (`qwen3-vl:4b-instruct`) reads document photos and emits JSON.

**Rejected:** classical OCR (PaddleOCR / Tesseract) extracting text, then a text LLM
structuring it.

**Reasoning:**
- The 7/12 land extract is a **table**. OCR returns a flat token stream and destroys the
  column relationships, forcing the downstream LLM to reconstruct structure by guessing.
  A VLM sees the layout.
- Input is phone photographs of crumpled documents under poor light, not clean scans.
  Classical OCR degrades badly on these; VLMs degrade gracefully.
- PaddleOCR installation on Windows (paddlepaddle wheels + Python/Node bridge) is a
  multi-hour risk that cannot be absorbed in the remaining time.

**Honest caveat:** OCR is genuinely better on clean typed printouts. This is a close call
made under time pressure, not a universal truth.

**Revisit if:** extraction accuracy on real Marathi documents proves unusable (see G1).

> **Process note.** The team's original decision was OCR + LLM. A previous builder agent
> replaced it with a VLM silently and presented the result as settled, costing hours.
> The override was subsequently authorised by the team on 2026-11-13. It is recorded here
> *with its rejected alternative* so the reasoning is auditable.

### ADR-2: Eligibility verification is deterministic JavaScript — NOT an LLM

**Decided:** a pure-function rulebook decides eligibility. No model involvement.

**Rejected:** passing extracted data to an LLM to judge.

**Reasoning (this one is not negotiable):**
- **LLMs have no clock.** "Is this certificate older than 12 months?" cannot be answered
  by a model that does not know today's date. It will guess, confidently.
- **Non-deterministic.** The same documents could yield different verdicts on different
  runs. Indefensible for government eligibility.
- **Not unit-testable.** This is decisive. During scaffolding, a test caught a real bug
  where `"Ramesh Shankar Patil"` matched `"Ramesh Shankar Pawar"` at 0.86 similarity —
  the exact demo case, silently broken. An LLM verifier admits no such test; that bug
  would have surfaced live in front of judges.
- Comparing `186000 < 800000` does not require intelligence. It requires correctness.

**The principle: the smart part reads, the dumb part decides.**

### ADR-3: Outbound language via a pre-written catalog — NOT runtime translation

**Decided:** every user-facing string lives in `src/i18n/{en,mr}.json`.

**Reasoning:** zero latency, cannot hallucinate, and translation work parallelises with
pipeline work. Only extracted values are interpolated into placeholders.

### ADR-4: Generate the PDF from scratch — NOT overlay an official template

**Decided:** `pdf-lib` draws a clean form.

**Reasoning:** coordinate-mapping a government PDF is a multi-hour fiddle and looks
identical on a phone screen. Revisit only if everything else is finished.

### ADR-5: WhatsApp as the interface — NOT a web portal

**Decided:** Meta WhatsApp Cloud API.

**Rejected:** a web upload page.

**Reasoning (team's, recorded from the original blueprint):** it eliminates the friction
of forcing rural citizens or busy CSC operators to download a new application or navigate
a complex web interface. The target users already have WhatsApp, and it supports native
voice notes, which the PS's MVP line requires.

**Cost accepted:** Meta developer account setup, number verification, a 5-number sandbox
allowlist, ngrok tunnelling, 5-minute media expiry, the 24-hour service window, and a
token that expires daily. Roughly 6 hours of Dev 3's time versus ~2 for a web page.

**Revisit trigger — explicit:** if B4 (webhook handshake passing, a text message
round-tripping) is not working by **hour 12**, fall back to a web upload page. Layers 1–3
are channel-agnostic; only `src/whatsapp.js` and the transport half of `src/server.js`
would be discarded. Do not let the channel sink the demo.

### ADR-6: EWS certificate as the target form

**Decided:** EWS (Economically Weaker Section) certificate.

**Status: this was never chosen by the team.** A previous agent selected it and the team
confirmed on 2026-11-13 that no form had been picked. It is retained on its merits, not
on authority.

**Reasoning:** EWS requires identity proof, income proof and a land record simultaneously,
so a single demo exercises the full cross-document validation pipeline. Its criteria are
also genuinely checkable: income below ₹8,00,000 and agricultural land below 5 acres —
meaning the land record is an eligibility input in its own right, not just a name-matching
source.

**Revisit if:** the team has a form they actually want. Only `src/rulebook.js` and the PDF
field list change; extraction and transport are unaffected.

### ADR-8: Script handling — transliteration for matching ONLY

Three independent axes. Do not conflate them.

| Axis | Determined by | Handled by |
|---|---|---|
| Script **on the document** | the document | VLM reads any script. No per-language config. |
| Language of **replies** | the user's pick | i18n catalog |
| Script **on the output form** | the **form**, not the user | `outputScript` per-form config |

**Default `outputScript` is `latin`.** Nearly all government forms accept Latin input;
Devanagari is optional. This means `@pdf-lib/fontkit` and a Noto font are **not needed**
unless a form explicitly requires Devanagari output.

**Cross-script matching problem.** If the Aadhaar is Latin and the 7/12 is Devanagari,
naive comparison gives ~0% similarity and the rulebook **falsely rejects a legitimate
applicant**. Every name field therefore carries two forms:

```json
"full_name":       "String - exactly as printed on the document",
"full_name_latin": "String - Roman script. If printed bilingually, use the printed English EXACTLY. Otherwise transliterate."
```

System prompt needs this carve-out, since constraint 2 otherwise forbids it:

```text
6. TRANSLITERATION: Converting a visible name into Roman script is permitted and required. Inventing a name that is not visible is not.
```

**THE RULE — transliteration is for matching only, never for output.**

| Use | Field |
|---|---|
| Cross-document matching | `*_latin` — fuzzy matching absorbs Patil/Paatil variance |
| Error messages to the user | as printed, so it matches the paper in their hand |
| **The output form** | **printed text only. Never a machine transliteration.** |

A wrong transliteration on a submitted form is a *silent* failure discovered weeks later at
the counter — precisely the failure this product exists to prevent. Where a document prints
no Latin name and the form needs one, **ask the user** (see ADR-9); they know how their name
is spelled in English.

### ADR-9: Chat review-and-correct before the form is generated

**Decided:** after validation passes, the bot lists every extracted field in the chat and
the user confirms or corrects each one — by text **or voice note** — before the PDF is
produced. The bot never submits anything.

**Rejected:** a fillable PDF the user edits in a reader; browser automation of the portal.

**Confirmed by the team on 2026-11-13 after re-reading the PS.** The MVP line parses as:

```
Multilingual voice-and-chat   →  form filling
automated                     →  pre-submission OCR validation
```

"Automated form filling" does not appear in the PS. "Automated" modifies the validation,
not the filling. **There is no autofill feature in this project** — there is automated OCR
validation before submission, and form filling that happens through voice and chat.
Do not reopen this.

**Reasoning — this is the PS's own wording:**
- *"voice-and-chat **form filling**"* — the filling happens in the conversation. A PDF
  reader or browser moves correction out of chat.
- *"**pre-submission** validation"* — submission is explicitly not ours. No portal
  automation, no Submit button, ever.
- **Voice only works here.** You cannot speak into a PDF reader or a browser field. The
  PS's "voice-and-chat" phrase only coheres with in-chat correction.

It is also the cheapest of the three (~1.5 hrs vs 2 and 6).

**This closes the transliteration risk from ADR-8:** a machine guess is no longer dangerous
once it is a draft the user approves.

**Reuses existing machinery:** i18n catalog for prompts, session `profile` for state, and
the same delta-intake pattern that already asks for "purpose of application".

**Flow:**
```
3 photos → extract → validate → review each field in chat → corrections → PDF → user submits
```

### ADR-10: Voice is for commands, NOT dictation — measured, not assumed

**Decided:** `faster-whisper` `small`, with the session language always forced. Voice
drives confirmations and field selection. Values are typed.

**Measured on the target machine** (RTX 3050 laptop, CPU int8, four real Marathi clips):

| Setting | Result |
|---|---|
| `small`, language forced | 1.6–3.0s, partial transcript |
| `small`, auto-detect | identified Marathi as **Tagalog** (0.33); Latin gibberish |
| `medium` | **118s** for a 3.5s clip, output was `॥।।` — worse AND 70× slower |

**Never auto-detect.** The language button is the single source of truth and is passed
to Whisper on every request. Auto-detect is not a fallback; it is actively harmful.

**Do not "upgrade" to medium.** Bigger is worse here. Re-measure before changing.

**The accuracy shape, from ground truth** ("माझ्याकडे एक फोन आहे"):

```
माझ्याकडे -> माजा करे   (close)
एक        -> एक          EXACT
फोन       -> पोज         WRONG - a different word entirely
आहे       -> आहिए        (close)
```

Across four clips the pattern held: **numbers and short fixed words transcribe
reliably; content words do not.** One clip failed completely (`ौ ौ ौ ौ`, degenerate
repetition).

**Why this is survivable:** B9's correction protocol is numeric (`3 <value>`), and the
number is exactly the part that transcribes correctly. Voice selects the field and
confirms; the value is typed. That is not a workaround bolted on afterwards — the
protocol happened to sit on the reliable part.

**Pitch framing:** demo the bot mishearing and the user correcting it. Every judge has
had voice input mangle their name; a visible correction is more convincing than a claim
of perfect transcription.

**Known gap, deliberately left:** a voice correction currently applies immediately with
an echo. Given फोन→पोज, voice corrections could instead require explicit confirmation
before being written, while typed ones apply directly. One extra round trip. Not built.

### ADR-7: Language scope — DECIDED: English, Hindi, Marathi

**Decided 2026-11-13:** three languages. `src/i18n/{en,hi,mr}.json`, 35 keys each,
enforced identical by `src/i18n.test.js`.

**Stop at three.** Not because more is hard — a new language is one JSON file — but
because **you can only ship languages a team member can proofread.** A garbled string
shown to a judge who speaks that language is worse than plain English. Three is also the
maximum number of WhatsApp reply buttons; a fourth needs an interactive list.

**Pitch line:** *"adding a language is one JSON file — we shipped three we can vouch for."*

**How Marathi originally got in:** it cascaded unexamined. A previous agent chose the
7/12 extract as the land record, the 7/12 is a Maharashtra document, and Marathi
followed. Hindi — with far greater reach — was never considered until the team caught it.
Recorded because it shows how an unstated choice becomes a fact nobody decided.

**Adding a fourth language (if someone can verify it):**
1. Copy `en.json` → `xx.json`, translate all 35 values
2. Import and register it in `src/i18n/index.js`
3. Replace the button picker in `sendWhatsAppLanguagePicker` with an interactive list
4. Add the language code to `SUPPORTED` in `src/stt.js`
5. Add its field words to `FIELD_WORDS` in `src/stt.js` and confirm words to
   `CONFIRM_WORDS` in `src/review.js`
6. `node src/i18n.test.js` must pass — it checks key parity, placeholder integrity and
   untranslated strings

**Original context for the decision:**
- Language scope and document choice are **coupled**. The 7/12 is Maharashtra/Gujarat; the
  equivalent is the Khasra/Khatauni in UP and MP, the Jamabandi in Punjab, Haryana and
  Rajasthan. Dropping Marathi means changing the demo land record to stay coherent.
- The real limit is **verification, not engineering**. A new language is 19 strings and
  ~20 minutes. But a garbled string shown to a judge who speaks that language is worse
  than plain English. **Ship only languages a team member can read and check.**
- Adding Hindi: copy `mr.json` → `hi.json`, translate 19 strings, one line in
  `src/i18n/index.js`, one button in `sendLanguagePicker`. No other code changes.

**Recommendation if the team does not respond:** English + Hindi + Marathi, and stop at
three. The honest pitch line is *"adding a language is one JSON file — we shipped three we
can vouch for."*

---

## 2. System Overview

```
WhatsApp ──webhook──> Express ──> [VLM: read] ──> JSON profile
                         │                            │
                         │                            v
                         │                   [Rulebook: decide]
                         │                       │         │
                         │                 problems      pass
                         │                       │         │
                         └────reply in user's language   PDF ──> WhatsApp
```

**Three layers, strictly separated:**

| Layer | Module | Responsibility | AI? |
|---|---|---|---|
| 1. Extract | `src/extractor.js` | photo → JSON. Form-agnostic. Makes no decisions. | VLM |
| 2. Decide | `src/rulebook.js` | JSON → pass / list of problems | **No** |
| 3. Respond | `src/pdf.js`, `src/i18n/` | fill form, or ask for what's missing | No |

Layer 1 does not know which form the user wants. Layer 2 does not know how the data was
obtained. Adding a second government form means writing a new Layer 2 rulebook only.

---

## 3. Model & Hardware Specification

**Target hardware:** NVIDIA RTX 3050, 6 GB VRAM, Windows.

| Component | Choice | Size | Notes |
|---|---|---|---|
| Vision | `qwen3-vl:4b-instruct` | 3.3 GB | fits 6 GB with headroom for image context |
| Fallback | `qwen3-vl:2b-instruct` | 1.9 GB | if 4b is too slow; weaker on Devanagari |
| Speech | `faster-whisper` `small` | ~0.5 GB | only if the core pipeline is finished |

**Mandatory constraints:**
- Use `-instruct` tags. **Never `-thinking`** — those emit visible reasoning, which breaks
  strict JSON output and roughly doubles latency.
- `qwen3-vl:8b-instruct` (6.2 GB) will **not** fit 6 GB VRAM. It will spill to CPU and
  take 60s+ per document. Do not use it.
- Set `options.temperature = 0` on every inference. Determinism over fluency.
- Qwen3-VL benchmarks ahead of specialised OCR models on Devanagari, but **no small open
  model is reliably good at Indic script**. English benchmarks do not predict Indic
  performance. This is the project's largest technical risk — see G1.

---

## 4. Data Contracts

These schemas are the interface between Layer 1 and Layer 2. **Do not change field names
without updating both sides and the fixtures.**

### 4.1 Universal system prompt (every image inference)

```text
You are a highly secure, deterministic Government Document OCR Data Extraction Engine. Your sole function is to analyze the provided image, extract the required fields, and output them STRICTLY as a valid JSON object.

CRITICAL CONSTRAINTS:
1. NO CONVERSATION: Do not output any conversational text, greetings, explanations, or markdown formatting outside of the raw JSON block.
2. ZERO HALLUCINATION: Do not infer, guess, or calculate any missing information. If a requested field is blurry, cropped, or not present in the image, you must output the exact string "NULL" for that key.
3. NO DATE MATH: Never compute ages, durations, validity or expiry. Transcribe dates exactly as printed and nothing more.
4. EXACT SPELLING: Transcribe names and addresses exactly as they appear in the image, preserving all regional spellings and typos.
5. REDACTION COMPLIANCE: Never output a full 12-digit government ID number. Output only the digits explicitly requested by the schema.
6. TRANSLITERATION: Converting a visible name into Roman script is permitted and required. Inventing a name that is not visible is not.
```

### 4.2 Schemas

**`identity`**
```json
{
  "document_type": "IDENTITY_CARD",
  "full_name": "String, exactly as printed",
  "full_name_latin": "String, Roman script. Printed English if bilingual, else transliterate",
  "date_of_birth": "String YYYY-MM-DD, or YYYY if only year visible",
  "gender": "MALE | FEMALE | OTHER",
  "address": "String, all lines combined",
  "pin_code": "String, 6 digits",
  "id_number_last_four": "String, final 4 digits only",
  "image_quality_flag": "Boolean, true if too blurry to read"
}
```

**`income`**
```json
{
  "document_type": "INCOME_CERTIFICATE",
  "applicant_name": "String, exactly as printed",
  "applicant_name_latin": "String, Roman script. Printed English if bilingual, else transliterate",
  "certified_annual_income": "String, digits only e.g. 120000",
  "issuing_authority": "String, officer designation",
  "issue_date": "String YYYY-MM-DD",
  "certificate_number": "String"
}
```

**`land`**
```json
{
  "document_type": "LAND_RECORD",
  "village_name": "String",
  "taluka_and_district": "String",
  "survey_number": "String",
  "total_area_hectares": "String",
  "owner_names": ["String, every occupant/owner listed, exactly as printed"],
  "owner_names_latin": ["String, same list in Roman script, same order"],
  "record_print_date": "String YYYY-MM-DD, or NULL if not printed"
}
```

> **Do not add a field asking the model whether a document is expired.** That requires
> date maths the model cannot do and contradicts constraint 3. Extract the raw date;
> Layer 2 decides staleness.

### 4.3 Output parsing (mandatory)

VLMs wrap JSON in markdown fences roughly a third of the time regardless of instructions.
Every extraction call MUST:
1. Strip ``` fences, slice from first `{` to last `}`, then `JSON.parse`.
2. On failure, retry the inference **once**, then surface a user-facing error.
3. Re-mask any 12-digit sequence with a regex **before logging or storing**. The model is
   not a security control.

---

## 5. The Verification Rulebook (Layer 2)

Pure functions. No network, no AI, no I/O. Fully unit-tested.

**Signature:** `validateEWS(profile, now = new Date()) -> { ok, errors[], missing[] }`
- `errors[]` — `{ key, params }` where `key` indexes the i18n catalog
- `missing[]` — document or field names not yet supplied
- `ok` — true only when both arrays are empty

### 5.1 Checks, in execution order

**1 — Quality gate.** If `identity.image_quality_flag === true`, return immediately with
`blurry_retry`. Do not validate an unreadable scan.

**2 — Completeness.** Any of `identity` / `income` / `land` absent → add to `missing[]`
and return. `purpose` (present on no document) is collected conversationally.

**3 — Cross-document consistency.** *The core value of this product.*
- `identity.full_name` must match at least one entry in `land.owner_names`
- `identity.full_name` must match `income.applicant_name`
- Matching is fuzzy — see 5.2

**4 — Expiry.**
- `income.issue_date` within **12 months** of now
- `land.record_print_date` within **6 months** of now
- Unparseable date → its own error key, not a silent pass

**5 — Eligibility (actual central EWS criteria).**
- `certified_annual_income` < **₹8,00,000**
- Agricultural land < **5 acres** (≈ **2.02 hectares**) — so `total_area_hectares` is
  itself an eligibility criterion, not just a name-matching source. This is why all three
  documents are genuinely required.

*(Full EWS criteria also cap residential flat and plot size. Mention as "extensible" in
the pitch; do not build.)*

**6 — Format.** PIN code exactly 6 digits; survey number non-empty.

### 5.2 Name matching — specific requirement

Exact equality fails on transliteration variance between documents and makes a correct
demo look broken. **But whole-string similarity is too permissive:**
`"Ramesh Shankar Patil"` vs `"Ramesh Shankar Pawar"` scores 0.86 because the first two
tokens carry the average, and a genuine surname mismatch passes.

**Required implementation:** normalise (case-fold, strip honorifics `shri|smt|mr|mrs|ms|kum|dr|late`,
strip punctuation, collapse whitespace), split into tokens, then require **both the first
token and the last token** to exceed 0.75 Levenshtein similarity independently.

This tolerates a missing middle name and rejects a different surname.

### 5.3 Scope limit — state this explicitly in the pitch

The system verifies **consistency, completeness and validity** — the causes of actual
counter rejection. It does **not** verify authenticity: no UIDAI or government database
access, no forgery detection, no confirmation that an issuing officer is real.

Claiming fraud detection will not survive judge questioning. The honest framing is
stronger: *"we catch what actually gets applications rejected; authenticity needs database
integration, which is what this plugs into."*

---

## 6. Conversation Flow (Layer 3)

### 6.1 State machine

```
LANGUAGE ──pick──> IDENTITY ──photo──> INCOME ──photo──> LAND ──photo──> validate
                                                                            │
                              ┌──errors────────────────────────────────────┤
                              │                                             │
                      report & stay                                     PURPOSE
                                                                            │
                                                                         REVIEW
                                                            (each field confirmed or
                                                             corrected, text or voice)
                                                                            │
                                                                   generate PDF → DONE
```

**REVIEW stage (ADR-9).** Present every field that will appear on the form, in the user's
language, values shown as printed on their documents. Accept corrections by text or voice
note. Corrections overwrite the profile; the PDF is generated only after the user confirms.
The bot never submits.

`"hi" | "hello" | "start" | "namaste"` resets the session at any point.

### 6.2 Session state

In-memory `Map` keyed by phone number. **No database** — this is a 24-hour build.

```js
{ phone, language, stage, profile: { identity, income, land, purpose } }
```

Also maintain a `Set` of processed `message.id` values. Meta retries aggressively; without
deduplication one photo is processed three times.

### 6.3 Language

First contact sends a WhatsApp interactive button list: **English / मराठी**. Store the
choice. If Whisper later detects a different language on a voice note, it overrides the
stored value and the bot confirms the switch in the new language.

---

## 7. WhatsApp Integration — Non-Negotiable Constraints

These three cause the most common total failures. Treat them as invariants.

**1. Acknowledge before processing.** `res.sendStatus(200)` must be the **first statement**
in the webhook handler, before any parsing. Inference takes 10–40 s; holding the webhook
open triggers Meta's retry logic and produces duplicate processing and a self-inflicted
denial-of-service loop. **This is the single most likely cause of on-stage failure.**

**2. Media URLs expire in 5 minutes.** Execute the two-step `GET` (metadata call, then
binary fetch with the Bearer token) to pull the buffer into memory the instant the webhook
arrives — before queueing, before any AI work.

**3. 24-hour service window.** Meta restricts free-form replies and document delivery to
24 hours after the user's last inbound message. All loops must complete inside it.

**Also required:**
- Send the `processing` message immediately after download. Async processing means silence,
  and 30 seconds of silence reads as a crash.
- Sandbox allows 5 pre-verified numbers. Add all 4 team SIMs to the allowlist.
- The temporary token expires in 24 hours. Regenerate immediately before the pitch.

---

## 8. Build Order

Dependencies are what matter here. Two tracks have external wait time and must start first;
everything else is offline work.

### Start immediately, in parallel
- **Dev 1:** `ollama pull qwen3-vl:4b-instruct` (3.3 GB). Begin the download before reading
  further.
- **Dev 3:** create the Meta app, verify the number, allowlist all 4 SIMs.

### The unblocking mechanism
`USE_MOCK=true` in `.env` makes `extractDocument()` return `fixtures/*.json` instantly.
**The entire pipeline is buildable and testable before the vision model exists.** Dev 2 and
Dev 4 must not wait for Dev 1. Flip to `false` when the model is ready; nothing else changes.

### Acceptance criteria per component

| # | Component | Owner | Done when |
|---|---|---|---|
| B1 | Rulebook | Dev 4 | `npm run test:rules` passes, incl. the planted-mismatch case |
| B2 | PDF generation | Dev 4 | `npm run test:pdf` writes a readable A4 form |
| B3 | Express + session | Dev 2 | `POST /dev/run` returns a validated profile and writes a PDF |
| B4 | Webhook | Dev 3 | Meta verification handshake passes; a text message round-trips |
| B5 | Media download | Dev 3 | a photo sent on WhatsApp lands in memory as a Buffer |
| B6 | Extraction | Dev 1 | a **real photograph** of each document type yields valid JSON |
| B7 | i18n | Dev 3 | every error path renders in both languages |
| B8 | Integration | all | photo on phone → validated → PDF back on phone |
| B9 | Review & correct | Dev 2 | every field confirmed or corrected in chat before the PDF is made — **DONE, 28 tests** |
| B10 | Voice | Dev 1 | **DONE, 16 tests.** Local Whisper service, no ffmpeg needed (faster-whisper bundles PyAV). See ADR-10 for measured limits. |

**B8 must be true by hour 16 even if ugly, English-only and with a crude PDF.** If hour 16
arrives without it, stop adding features and make what exists demo-reliable.

### Cut list, in order
1. Drop Marathi, English only
2. Skip voice (B10) entirely
3. Skip the language picker, hardcode English

**Do not cut B9 (review & correct).** It is the PS's "form filling" and it is what makes a
machine transliteration safe to put on a government form.

**Never cut:** photo → extract → cross-check → PDF. That spine is the product.

---

## 9. Risk Register

| id | Risk | Mitigation |
|---|---|---|
| **G1** | **VLM cannot read Marathi 7/12 tables** | Test on real photos in Dev 1's first 2 hours. If unusable, do **not** rebuild as an OCR pipeline — no time, and OCR does not solve the table problem either. Use a bilingual or English extract for the demo and state honestly that Indic accuracy improves with a larger model on better hardware. |
| G2 | npm install fails on venue network | Known issue — install failed once already. Use a phone hotspot; cache `node_modules` on a USB stick as backup. |
| G3 | Inference too slow, demo stalls | Async queue, holding message, pre-warm Ollama before going on stage. Fall back to `qwen3-vl:2b-instruct`. |
| G4 | Meta token expires mid-demo | Regenerate immediately before the pitch; know where the refresh control is. |
| G5 | Model returns unparseable JSON | Sanitiser + single retry + user-facing error that never shows a stack trace. |
| G6 | Venue Wi-Fi fails | Phone hotspot; **pre-record a screen capture of the full flow as backup**. |
| G7 | Judge challenges Aadhaar handling | Answer ready: processed locally, never transmitted, last 4 digits only, no UIDAI contact. |
| G8 | Judge asks why voice transcription is imperfect | Answer ready, and demo it rather than hide it: open models are weak on Marathi, so the user confirms every field before anything is generated. Nothing reaches the form unverified. See ADR-10. |
| G9 | Someone reinstalls the STT deps with `pip install faster-whisper` | Breaks every transcription (`metadata_errors`) while `/health` still reports OK. Use `stt/requirements.txt`; `stt/server.py` decodes audio itself. |
| G10 | Devanagari transcript crashes the STT log on Windows | Fixed — stdout is reconfigured to UTF-8. Without it, cp1252 raises `charmap` errors *after* a successful transcription, which reads like a model failure. |

---

## 10. Demo Script

Rehearse this exact sequence on the real phone by hour 21.

1. Send `hi` → language buttons → pick **मराठी**
2. *(if B9 shipped)* Send a **Marathi voice note** asking for an EWS certificate — this
   single step demonstrates both words in the PS's "multilingual voice-and-chat"
3. Send Aadhaar photo → bot reads it, replies in Marathi with the name and masked ID
4. Send Income Certificate
5. Send the 7/12 extract **with the planted name mismatch** (`fixtures/land_mismatch.json`)
6. **Bot catches it and explains the problem in Marathi** ← the entire pitch, in ten seconds
7. Send the correct 7/12, answer the purpose question
8. Filled EWS PDF arrives; open it on the phone, on stage

Step 6 is what separates this from an OCR demo. Plant the error deliberately and rehearse it.

**Closing line for the pitch:** *"The AI never decides eligibility. It only reads. Every
decision is deterministic code you can audit line by line."*
