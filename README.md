# PS 19 — AI Government Form & Document Verification Assistant

WhatsApp bot. Citizen sends three documents, local AI reads them, the rulebook
cross-checks them **against each other**, and a filled EWS form comes back as a PDF.

Everything below runs **with no AI and no WhatsApp account**, so nobody is blocked.

## Start here (2 minutes)

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

## Who owns what

| File | Owner | Blocked by |
|---|---|---|
| `src/extractor.js` | Dev 1 | needs Ollama — **start `ollama pull qwen2-vl:7b` now** |
| `src/server.js`, `src/session.js` | Dev 2 | nothing |
| `src/whatsapp.js`, `src/i18n/*` | Dev 3 | needs Meta app — **create it now** |
| `src/rulebook.js`, `src/pdf.js` | Dev 4 | nothing |

Only two tracks have external wait time. Start those downloads and accounts first;
everything else is offline work.

## The mock switch

`.env` has `USE_MOCK=true`. Extraction returns `fixtures/*.json` instantly, so the
pipeline is fully testable before the vision model exists.

When Dev 1's model is ready, set `USE_MOCK=false`. Nothing else changes.

## Architecture

**Layer 1 — Extract** (`extractor.js`) · photo → JSON. The AI does not know which
form the user wants; it only reports what is on the document.

**Layer 2 — Validate** (`rulebook.js`) · pure JavaScript, no AI. Name matching across
documents, date recency, income ceiling. Deterministic, so it never surprises you on stage.

**Layer 3 — Fill** (`pdf.js`) · ask for whatever is still missing, then generate the PDF.

Adding a second government form later means writing a new Layer 2 rulebook only.
That is the answer when a judge asks whether it scales past one form.

## Connecting WhatsApp (Dev 3)

1. Meta Developer Dashboard → create app → add WhatsApp product
2. Add all 4 team SIMs to the allowlist (sandbox caps at 5 numbers)
3. Copy the temporary token and Phone Number ID into `.env`
4. Expose the server: `npx ngrok http 3000`
5. Webhook URL = `https://<ngrok-url>/webhook`, verify token = whatever is in `.env`
6. Subscribe to the **messages** field

The token expires in 24 hours. Regenerate it immediately before the pitch.

## Three things that will break the demo

**Never move the `res.sendStatus(200)` line** in `src/server.js`. Inference takes
10–40s. Hold the webhook open and Meta retries, processing the same photo repeatedly.

**Media URLs expire in 5 minutes.** `downloadMedia` is called the instant the webhook
arrives, before any AI work. Keep it that way.

**Test extraction on real document photos early.** Small vision models struggle with
Marathi 7/12 tables. Find that out at hour 5, not hour 18.

## Demo script

1. Send `hi` → language buttons → pick **मराठी**
2. Send Aadhaar photo → bot reads it, replies in Marathi
3. Send Income Certificate
4. Send the **7/12 with the planted name mismatch** (`fixtures/land_mismatch.json`)
5. **Bot catches it and explains the problem in Marathi** ← this is the pitch
6. Send the correct 7/12, answer the purpose question
7. Filled EWS PDF arrives on the phone

Step 5 is the whole product in ten seconds. Rehearse it on the real phone by hour 21.

## Cut list, in order

1. Drop Marathi, English only (costs nothing in the demo)
2. Skip voice input entirely
3. Skip the language picker, hardcode English

**Never cut:** photo → extract → cross-check → PDF. That spine is the product.
