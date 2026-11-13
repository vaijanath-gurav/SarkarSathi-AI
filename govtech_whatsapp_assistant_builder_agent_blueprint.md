# Master Engineering & Architecture Blueprint: PS 19 — AI Government Form & Document Verification Assistant

**Context for Builder Agent:** This document is the single-source-of-truth technical execution strategy for a **24-hour hackathon build** answering **Problem Statement 19 (GovTech / Document AI / Multilingual NLP)**. It is a demo, not a production product: build nothing that does not appear on stage. Follow every architectural constraint, API limitation and prompt schema below without deviation.

---

## 0. PS 19 Coverage Map

Every line of the problem statement must be visibly answered in the demo. This table is the acceptance checklist — if a row is not demonstrable, the build is incomplete.

| PS 19 requirement | How this build answers it | Owner |
|---|---|---|
| Multilingual NLP | Language chosen at session start; every outbound message served from a pre-written i18n catalog (English / Hindi / Marathi) | Dev 3 |
| **Voice**-and-chat form filling | Local Whisper STT on WhatsApp voice notes; transcript feeds the same slot-filling engine as typed text | Dev 1 + Dev 2 |
| Automated **pre-submission** OCR validation | Layer 2 deterministic rulebook runs before any PDF is generated; failures are reported, not submitted | Dev 4 |
| Aadhaar / identity documents | `IDENTITY_CARD` schema, last-4 digits only | Dev 1 |
| Income certificates | `INCOME_CERTIFICATE` schema + 12-month recency check | Dev 1 + Dev 4 |
| Land records (7/12) | `LAND_RECORD` schema + cross-document owner-name match | Dev 1 + Dev 4 |
| Inconsistent document formats | VLM reads visual layout directly, no brittle OCR text pipeline | Dev 1 |
| Language barriers | Voice input in regional language + replies in the same language | Dev 3 |
| Target customers (CSCs, citizens, small businesses, tax/legal consultants, Gram Panchayats, e-gov portals) | Named explicitly in the pitch; CSC operator is the demo persona | Dev 4 |
| Revenue streams | Pitch slide only — **write no billing, metering, auth-tier or subscription code** | Dev 4 |

---

## 1. Executive Summary & Positioning

Citizens and small businesses face repeated rejection of government applications because of language barriers, inconsistent document formats and manual data-entry error. Discrepancies across Aadhaar, Income Certificates and 7/12 Land Records cause prolonged delays at Common Service Centres (CSCs) and state e-governance portals.

This build is a **multilingual, voice-first assistant delivered over WhatsApp**, backed by a verification engine that validates a citizen's documents *against each other* before anything is submitted. The pitch framing is a verification layer that CSCs, Gram Panchayats, tax and legal consultants and e-governance portals could license per application — but for the hackathon, that is a slide, not a subsystem.

**Why WhatsApp (not in the PS — a deliberate choice to justify on stage):** the PS names no channel. WhatsApp is chosen because the target users already have it, it supports native voice notes (which the PS's MVP line requires), and it removes app-download and portal-navigation friction for rural users. State this reasoning explicitly in the pitch so the choice does not read as arbitrary.

---

## 2. The AI Engine: 100% Local Vision + Speech

Both AI stages run locally. Nothing leaves the deployment machine.

### 2.1 Vision — Document Understanding
**Ollama** running a lightweight open-weights Vision-Language Model (`llama3.2-vision:11b` or `qwen2-vl:7b`).

*   **Data sovereignty:** this is the real argument, and the one judges will press. Government clients will not accept unmasked Aadhaar numbers and income records being transmitted to third-party offshore cloud servers. A local pipeline guarantees citizen PII never leaves the environment.
*   **Near-zero marginal cost:** compute per verification is effectively free once hardware is provisioned. Say *"near-zero marginal cost"* on stage, never *"₹0"* — hardware and power are real costs and a judge will call it out.
*   **Why a VLM over traditional OCR:** classic OCR pipelines collapse on crumpled, poorly lit, tabular regional documents such as a Marathi 7/12 extract. A VLM reads visual layout and semantic meaning together, skipping the brittle text-extraction stage and emitting JSON directly.

### 2.2 Speech — Voice Note Transcription
**`faster-whisper`** (or `whisper.cpp`) running the `small` multilingual model, exposed to Node over a thin local HTTP wrapper or invoked as a child process.

*   Meta delivers voice notes as **OGG/Opus**. Whisper will not ingest this directly — pipe the downloaded buffer through **`ffmpeg`** to 16 kHz mono WAV before transcription. Budget this step; it is the most common silent failure in this pipeline.
*   Whisper returns both the transcript **and a detected language code**. Capture the language code — it seeds the multilingual layer described in Section 4.
*   Use `small`, not `medium` or `large`. On hackathon laptop hardware the larger models push a 15-second voice note past 30 seconds of processing, which breaks the feel of the demo.

---

## 3. Prompt Engineering for Zero-Hallucination Extraction

Conversational prompting fails catastrophically on sensitive government documents. The model must be constrained to act as a deterministic data parser so the Node.js rulebook can parse variables predictably.

### 3.1 The Universal System Prompt
Injected into the Ollama context (`/api/generate`) for **every single image inference**.

```text
You are a highly secure, deterministic Government Document OCR Data Extraction Engine. Your sole function is to analyze the provided image, extract the required fields, and output them STRICTLY as a valid JSON object.

CRITICAL CONSTRAINTS:
1. NO CONVERSATION: Do not output any conversational text, greetings, explanations, or markdown formatting outside of the raw JSON block.
2. ZERO HALLUCINATION: Do not infer, guess, or calculate any missing information. If a requested field is blurry, cropped, or not present in the image, you must output the exact string "NULL" for that key.
3. NO DATE MATH: Never compute ages, durations, validity or expiry. Transcribe dates exactly as printed and nothing more.
4. EXACT SPELLING: Transcribe names and addresses exactly as they appear in the image, preserving all regional spellings and typos.
5. REDACTION COMPLIANCE: Never output a full 12-digit government ID number. Output only the digits explicitly requested by the schema.
```

> **Builder note — defence in depth:** the model is not a security control. Re-mask every ID number in Node.js with a regex before anything is logged, cached or written to disk. Assume the model will leak a full number eventually.

### 3.2 Target Document JSON Schemas (User Prompts)
The Node.js server appends the schema matching the document type under evaluation.

**Identity Document Schema:**
```text
Analyze the attached identity document. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "IDENTITY_CARD",
  "full_name": "String - The exact full name of the individual",
  "date_of_birth": "String - Format strictly as YYYY-MM-DD. If only birth year is visible, output YYYY",
  "gender": "String - MALE, FEMALE, or OTHER",
  "address": "String - The complete printed address, combining all lines",
  "pin_code": "String - The 6-digit postal code if visible",
  "id_number_last_four": "String - Only the final 4 digits of the ID number",
  "image_quality_flag": "Boolean - Set to true if the image is too blurry to read critical fields"
}
```

**The 7/12 Land Record Schema:**
```text
Analyze the attached agricultural land record (7/12 extract). This document may contain complex tables and regional languages. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "LAND_RECORD",
  "village_name": "String - The name of the village/village panchayat",
  "taluka_and_district": "String - The sub-district (Taluka) and District names",
  "survey_number": "String - The Survey Number / Gat Number / Khata Number",
  "total_area_hectares": "String - The total land area listed, usually in Hectares or Acres",
  "owner_names": ["String - Array of all individual occupant/owner names listed in the ownership column. Extract every name."],
  "record_print_date": "String - The print/issue date stamped on the extract, formatted YYYY-MM-DD. Output NULL if no date is printed."
}
```

> **Changed from v1:** the old `is_expired_or_old` boolean asked the model to compare the print date against "today", which directly contradicts the no-calculation constraint and assumes the model knows the current date — it does not. Extract the raw date; let Node.js decide staleness.

**The Income Certificate Schema:**
```text
Analyze the attached state-issued Income Certificate. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "INCOME_CERTIFICATE",
  "applicant_name": "String - The name of the person whose income is being certified",
  "certified_annual_income": "String - The total annual income amount in numbers (e.g., 120000)",
  "issuing_authority": "String - The designation of the officer who issued the certificate",
  "issue_date": "String - The exact date the certificate was issued, formatted as YYYY-MM-DD",
  "certificate_number": "String - The unique application or certificate registration number"
}
```

### 3.3 Parsing Defence
VLMs wrap JSON in markdown fences roughly a third of the time regardless of instructions. Every extraction call must pass through a sanitiser that strips ``` fences, slices from the first `{` to the last `}`, and retries the inference **once** on parse failure before surfacing an error to the user. Do not skip this — it is the difference between a demo that works and one that doesn't.

---

## 4. The Multilingual Conversation Layer

The PS opens with *Multilingual NLP* and the MVP line begins with *multilingual*. A bot that reads a Marathi document but replies in English will not read as multilingual to a judge. Input and output must both be in the user's language.

**Language selection:** on first contact, send a WhatsApp interactive list — **English / हिंदी / मराठी**. Store the choice in session state. For voice notes, Whisper's detected language code overrides the stored value if it differs, and the bot confirms the switch in the new language.

**Outbound strings — a pre-written catalog, never runtime translation.** Keep `i18n/en.json`, `i18n/hi.json`, `i18n/mr.json`, each keyed identically:

```json
{
  "ask_identity": "Please send a photo of your Aadhaar or identity card.",
  "ask_income": "Now send your Income Certificate.",
  "ask_land": "Now send your 7/12 land record extract.",
  "processing": "Reading your document, please wait…",
  "blurry_retry": "That image was too blurry to read. Please resend it in better light.",
  "name_mismatch": "The name on your identity card ({a}) does not match the owner name on the land record ({b}).",
  "income_stale": "Your Income Certificate is dated {d}, which is older than 12 months. Please provide a recent one.",
  "ask_purpose": "What is the purpose of this application?",
  "form_ready": "Your EWS application form is ready. Please review it before submission."
}
```

A catalog is the right call here for three reasons: it is instant (no inference latency on every reply), it cannot hallucinate, and translation work can happen in parallel on hour 2 while the pipeline is still being built. Only extracted values are interpolated into the slots.

**Inbound free-text understanding:** for the narrow slots this MVP collects (purpose of application, confirmations, corrections), keyword and regex matching against the active language is sufficient and far more reliable under demo pressure than an LLM intent classifier. Reach for a text model through Ollama only if a slot genuinely needs open-ended parsing.

---

## 5. Client Interface & Node.js Orchestration

The frontend is the **Meta WhatsApp Cloud API**; the engine is a **Node.js (Express)** server bridging Meta's webhooks, the local Ollama and Whisper instances, and PDF generation.

**Mandatory infrastructure constraints (hard limits):**

*   **Acknowledge first, process later (critical).** Meta expects an immediate `200 OK`. Call `res.sendStatus(200)` as the **first line** of the webhook handler, then push the job onto an in-memory queue and return. A VLM inference takes 10–40 seconds on laptop hardware; holding the webhook open for that long triggers Meta's retry logic and produces a self-inflicted denial-of-service loop with duplicate processing. **This is the single most likely way this build fails on stage.**
*   **The 5-minute media expiry.** Media URLs from the webhook expire in exactly 5 minutes. Execute the two-step `GET` (metadata call, then binary fetch with the Bearer token) to pull the buffer into memory **the instant the webhook arrives**, before queueing and before any AI processing.
*   **Send a holding message.** Because processing is async, immediately send the `processing` string from the i18n catalog, then send the real result as a separate message when the job completes. Silence for 30 seconds reads as a crash to anyone watching.
*   **The 24-hour service window.** Meta restricts free-form replies and document delivery to 24 hours after the user's last inbound message. All validation loops and form deliveries must complete inside it.
*   **Idempotency.** Meta retries on any non-200 or timeout. Track processed `message.id` values in a Set and drop duplicates, or one shaky network moment will run the same document through the VLM three times.
*   **Parallel testing (4 SIMs).** The free Meta Cloud API sandbox limits outbound messaging to 5 pre-verified numbers. The team holds exactly **4 physical SIM cards**; add all 4 to the Meta Developer Dashboard allowlist. This accommodates the 4-person team testing webhooks and uploads concurrently without hitting sandbox limits or paid tiers.

**Session state** — a plain `Map` keyed by phone number is sufficient for 24 hours. No database:
```js
{ language, formType, stage, profile: { identity, income, land }, missingFields, processedMessageIds }
```

---

## 6. The 3-Layer Canonical Data Architecture

The backend must not be hardcoded to a single form, so it can be pitched as scalable across hundreds of government services.

**Layer 1 — Form-Agnostic Extraction.** The server streams the downloaded image buffer to local Ollama, and voice-note buffers to local Whisper. The VLM extracts into the unified agnostic JSON profiles above. At this stage the AI does not know or care which form the user is applying for; it records only the reality of the documents.

**Layer 2 — The Business Logic Rulebook.** Deterministic JavaScript, keyed to the requested form. This layer is the PS's "automated pre-submission validation" and the technical heart of the demo. For the EWS certificate:
*   *Income recency:* is `issue_date` within the last 12 months of today?
*   *Land record staleness:* is `record_print_date` within the last 6 months?
*   *Fuzzy cross-matching:* does `full_name` from the identity profile match any entry in `owner_names` on the land record? Use a normalised comparison (case-fold, strip honorifics and extra whitespace, then Levenshtein distance) — exact string equality will fail on transliteration variance between documents and make the demo look broken when it is actually correct.
*   *Threshold check:* is `certified_annual_income` below the EWS ceiling?
*   *Quality gate:* if `image_quality_flag` is true, reject and ask for a resend before anything else.

**Layer 3 — Delta Intake & PDF Generation.** If the rulebook finds a missing field (e.g. "Purpose of Application", present on no document) or a validation failure, the server sends a targeted WhatsApp reply in the user's language asking **only** for that one item. Once the canonical profile passes every check, `pdf-lib` overlays the data onto a blank government PDF template and dispatches the file back over WhatsApp.

---

## 7. Target MVP Form & 24-Hour Execution

**Target Form:** the **EWS (Economically Weaker Section) Certificate** — chosen because it requires all three PS-named document types in a single flow, exercising the entire cross-validation pipeline in one demo.

### 7.1 Division of Labor

*   **Developer 1 — Local AI (Vision + Speech).** Provision Ollama and the VLM; provision `faster-whisper` and `ffmpeg`. Deliver the strict system prompts that force hallucination-free JSON from Indian IDs and regional land records, plus a working transcription path from OGG/Opus to text with a language code. **Test on real document photographs within the first three hours** — small vision models struggle with Marathi tables and handwriting, and discovering that at hour 18 ends the project.
*   **Developer 2 — Core Node.js Architect.** Scaffold Express, the session `Map`, the async job queue and the `/api/v1/verify-document` endpoint. Own the network bridge from Node to both local AI services, the JSON sanitiser and the retry logic.
*   **Developer 3 — WhatsApp & Multilingual Integration.** Meta Developer Portal configuration, webhook handling, the 5-minute media buffer download, idempotency tracking, outgoing text and document payloads, the interactive language picker, and the three i18n catalogs.
*   **Developer 4 — GovTech Logic & Presentation.** Translate EWS requirements into the rulebook, map canonical JSON onto the EWS PDF template with `pdf-lib`, assemble the demo documents, and build the pitch covering the PS's named customers and revenue streams.

### 7.2 Timeline

| Hours | Milestone |
|---|---|
| 0–3 | Ollama + VLM running and tested on **real** document photos; Express skeleton returning 200; Meta sandbox verified and the 4 SIMs allowlisted |
| 3–8 | Image → VLM → clean JSON working end to end for all three document types; media download from Meta proven |
| 8–12 | Whisper transcribing WhatsApp voice notes; i18n catalogs complete in all three languages |
| 12–16 | Rulebook complete and passing on a known-good and a known-bad document set |
| 16–20 | `pdf-lib` EWS form generation and delivery back over WhatsApp |
| 20–22 | **Full-path rehearsal on the actual demo phone** — not on localhost, not with curl |
| 22–24 | Pitch deck, backup recording, buffer |

**Build the happy path first, end to end, before any edge case.** A complete thin pipeline demos well; a sophisticated extraction stage with no PDF at the end does not.

### 7.3 Demo Script (rehearse this exact sequence)

1. Operator messages the WhatsApp number; bot replies with the language picker; operator selects **मराठी**.
2. Operator sends a **voice note in Marathi** saying they need an EWS certificate. Bot transcribes locally and confirms in Marathi. *(This single step demonstrates both words in "multilingual voice-and-chat".)*
3. Bot requests the identity document; operator photographs an Aadhaar card; bot extracts and echoes back the name and masked ID.
4. Operator sends the Income Certificate and the 7/12 extract.
5. **Bot catches a deliberate planted mismatch** — the name on the land record differs from the identity card — and reports it in Marathi. *This is the money shot: it is the PS's "pre-submission validation" visible on screen, and it is what separates this from a plain OCR demo. Plant the error deliberately and rehearse it.*
6. Operator corrects or confirms; bot asks the one genuinely missing field (purpose of application) by voice or text.
7. Bot delivers the filled EWS PDF to WhatsApp. Open it on the phone, on stage.

### 7.4 Risk Register

| Risk | Mitigation |
|---|---|
| VLM misreads Marathi 7/12 tables | Test hour 0–3; keep a known-clean sample as the demo document; fall back to a Hindi/English extract if accuracy collapses |
| Inference too slow, demo stalls | Async queue + holding message; `small` Whisper model; pre-warm Ollama before going on stage |
| Venue Wi-Fi fails | Phone hotspot ready; **pre-record a screen capture of the full flow as a backup** |
| Meta sandbox token expires mid-demo | Regenerate immediately before the pitch; know where the refresh button is |
| Model returns unparseable JSON | Sanitiser + single retry + a clear user-facing error that never shows a stack trace |
| Judge asks about Aadhaar legality / UIDAI compliance | Have the answer ready: local processing, no storage of full numbers, last-4 only, no UIDAI API contact |
