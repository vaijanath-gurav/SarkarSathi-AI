# Handoff — PS 19, GovTech Form & Document Verification Assistant

**Captured:** 2026-11-13. **Hackathon build, ~10 hours remaining at capture.**
Read this file first. It is the single entry point for anyone continuing this work.

---

## 1. Read these, in this order

| File | What it holds |
|---|---|
| `HANDOFF.md` (this) | state, every known defect, what is unproven |
| `BUILD_SPEC.md` | ADR-1 … ADR-10 — architecture decisions **with rejected alternatives** |
| `BUILD_PLAN_EXTENSION.md` | D1 … D15 locked decisions, Phases 1–8, all verification results |
| `EXECUTION_PLAN.md` | Section 0 — the rules any executing agent must follow |
| `README.md` | how to run each surface |

**`govtech_whatsapp_assistant_builder_agent_blueprint.md` is superseded.** It was written
by an agent that silently overrode the team's architecture choice and invented
requirements. Do not treat it as a source of truth.

---

## 2. Current state

**112 tests pass.** `npm test` runs five suites; `node src/fieldmap.test.js` runs a sixth.

| Component | State |
|---|---|
| Extraction (Layer 1, VLM) | working, **proven on 3 real Aadhaar cards** |
| Rulebook (Layer 2, no AI) | 21 tests |
| Review & correct (B9) | 28 tests |
| Voice (B10, Whisper) | 16 tests, limits measured |
| Languages en/hi/mr | 19 tests, parity enforced |
| Field matching | 17 tests, **8/10 fields verified on the real portal** |
| Orchestration | 13 tests |
| PDF | working, survives Devanagari input |
| Web page | working |
| Mock Marathi portal | working |
| Chrome extension | files complete, **never loaded in a browser** |
| WhatsApp transport | code written, **never run against Meta** |

### Run it

```bash
npm start                        # web page + portal + API on :3000
npm test                         # five suites
node src/fieldmap.test.js        # sixth suite
npm run sim                      # whole conversation, no network
npm run sim:mismatch             # the demo case: validation blocks the PDF
python stt/server.py             # voice service, ~70s to load
```

Ollama must be running with `qwen3-vl:4b-instruct`.

---

## 3. Every defect found, and what came of it

### 3.1 Planning defects (4) — all in specs, none in code

Each was caught by a subagent stopping at a verification step rather than working around
it. **This is the process functioning. Keep it.**

| # | Defect | Resolution |
|---|---|---|
| 1 | `fieldmap.test.js` expected 15 checks; the spec contained 14 | added a real 15th test rather than lowering the number |
| 2 | `forms/*.json` mapped `#taluka` and `#district` both to `land.village_name` | removed; derived values cannot be expressed as plain paths. Keyword fallback handles them |
| 3 | Nothing served `public/` statically — `portal.html` 404'd | added `app.use(express.static('public'))` after the router |
| 4 | i18n test expected 25 passes; its count is fixed at 19 | corrected. The suite loops over **languages, not keys** — adding keys cannot raise it |

### 3.2 Code bugs caught by tests (5)

| # | Bug | Why it mattered |
|---|---|---|
| 1 | Fuzzy matcher passed `Patil` vs `Pawar` at 0.86 | **the exact demo case, silently broken.** Whole-string similarity let the matching first two names carry it. Now compares token-by-token, requiring first and last to match independently |
| 2 | `"Okay."` did not confirm | Whisper punctuates. `CONFIRM_WORDS` held `okay`, transcript said `okay.` The user says okay at the final step and the bot says "I did not understand" |
| 3 | Trailing full stops kept in values | `"Ramesh Padal."` — a period onto a government form |
| 4 | Spoken-number branch lowercased values and kept connector words | `"number three is Patil"` → `3 is patil` |
| 5 | `VLM_MODEL` defaulted to `qwen2-vl:7b` | an outdated recommendation never propagated to code. A fresh clone with no `.env` 404'd |

### 3.3 Environment and dependency traps (8)

These cost the most time. **All are documented in code comments at the relevant line.**

| # | Trap |
|---|---|
| 1 | `npm install` failed twice on venue wifi. Retry with `--fetch-retries=10` |
| 2 | **`pip install faster-whisper` silently breaks every transcription.** It pulls PyAV 19; faster-whisper 1.2.1 calls `av.open(metadata_errors=…)` which PyAV removed. `/health` still returns OK, so it only shows on the first real voice note. `stt/server.py` decodes audio itself to sidestep this. Use `stt/requirements.txt` |
| 3 | Pinning `av<15` does **not** work — no wheel for Python 3.12 on Windows, and building needs FFmpeg dev libraries |
| 4 | Windows console is cp1252 and **raises on printing Devanagari**. A perfect Hindi transcript died in the log line, surfacing as a `charmap` error that looks like model failure. `stt/server.py` reconfigures stdout to UTF-8 |
| 5 | `vad_filter=True` + greedy decoding returned **empty text after 27s** on short Marathi clips. Now `beam_size=5`, `vad_filter=False` — both faster and correct |
| 6 | Whisper **auto-detect identified Marathi as Tagalog** at 0.33 confidence and produced Latin gibberish. The language button now always drives Whisper. Never auto-detect |
| 7 | `pdf-lib` standard fonts are WinAnsi and **throw** on Devanagari. `src/pdf.js` strips unencodable characters via `safe()` |
| 8 | Whisper `medium` took **118s for a 3.5s clip** and produced worse output than `small`. Do not "upgrade" |

### 3.4 Model findings, measured

**Vision — `qwen3-vl:4b-instruct` on RTX 3050 6GB**

- Cold start **53s**, warm text **2.6s**, images **3–9s**
- Three real Aadhaar cards, three scripts, angles and glare: **all read, none hallucinated**
- **Redaction held.** A card with `XXXX XXXX 2516` plainly visible returned only `2516`
- A blank Marathi form returned every field `NULL` — no invented data
- **Known limit:** a low-resolution card returned `Surname Firstname Father**x**name` for
  `Fathername`. The fuzzy matcher scores that 0.92 and **passes it** — by design, so
  transliteration variance does not falsely reject real people. **This class of error
  clears every automated check. Only B9's human review catches it.**
- **Accepted limitation:** Indic scripts are normalised toward Devanagari. A Gurmukhi card
  printing `<Gurmukhi name>` returns `<Devanagari name>`. Prompt constraint 8 had no effect. Harmless —
  matching and the form use `full_name_latin`, which was correct every time

**Speech — `faster-whisper small`, CPU int8**

- 1.6–3.0s per clip with the language forced
- Four real Marathi recordings: **numbers and short fixed words transcribe reliably,
  content words do not.** One clip failed completely (`ौ ौ ौ ौ`, degenerate repetition)
- Ground truth `माझ्याकडे एक फोन आहे` → `मला ... एक ... पोज`. **`एक` exact, `फोन` → `पोज`**
- This is why the review protocol is **numeric** (`3 <value>`): the number is the part that
  transcribes correctly. Voice selects the field and confirms; values are typed

---

## 4. What is NOT proven

Ranked by risk.

1. **The 7/12 land record has never been through the model.** A dense Marathi table is the
   hard case, and the case the VLM architecture was chosen for (ADR-1). Everything else is
   built on the assumption it works. **Test this first.**
   ```bash
   node src/extract.cli.js land path/to/712.jpg
   ```
2. **The Chrome extension has never been loaded.** Files exist, manifest parses, JS
   syntax-checks. No panel, fill, voice or convert behaviour has been observed.
   `chrome://extensions` → Developer Mode → Load unpacked → `extension/` → `Ctrl+Shift+F`
   on `http://localhost:3000/portal.html`
3. **`MASTER/` is empty.** No client exists, so the dropdown is blank. Drop one real
   document into each of `MASTER/ADHAAR`, `MASTER/INCOME CERTIFICATE`,
   `MASTER/LAND RECORDS` and restart — extraction runs at startup and caches beside each file
4. **WhatsApp has never run against Meta.** Needs a developer account, 5-number allowlist,
   ngrok, and a token that expires every 24 hours. ADR-5 sets an hour-12 fallback to the
   web page; that fallback has effectively been taken

---

## 5. Working agreements (carry these forward)

From `handoff/memory/`:

- **The planner does not write code.** Decide everything, write a decision-free plan,
  dispatch a Sonnet subagent, stay available. Verify its work independently — a
  subagent's report is not proof
- **Never start work unannounced.** A vague go-ahead is a request to say what comes next,
  not approval to begin
- **Restart failed downloads automatically**, in the background, without asking
- **Business model is pitch framing only.** Build no billing, auth tiers or metering

### Rules that produced the good outcomes

Every subagent brief carried these. They are why four plan defects surfaced as clean stops
instead of silent breakage:

1. Make no design decisions
2. Do not substitute approaches
3. Stop on any mismatch and report expected-vs-actual
4. **Never weaken a test to make it pass.** If a test fails, the code is wrong

---

## 6. Backup contents and paths

```
handoff/
  memory/        5 files — working agreements, copied from the user's memory store
  transcript/    session-export-*.zip — full conversation + subagent transcripts
  data/
    fixtures/            cross-script test data, incl. the planted-mismatch record
    forms/               curated form mappings
    i18n/                en / hi / mr catalogs, 55 keys each
    package.json
    .env.example
    state-snapshot.json  node version, deps, file inventory, capture time
```

**Source of the memory copy:**
`C:\Users\gurav\.claude\projects\C--Users-gurav-Desktop-vaij-d-grt\memory\`

**Original transcript export:** `C:\Users\gurav\Downloads\session-export-1794588748644.zip`

**Sample Aadhaar images used for testing:** `C:\Users\gurav\Downloads\Adhhar eg\`
(public samples. `C:\Users\gurav\Downloads\in.gov.uidai-ADHAR-*.xml` is real offline e-KYC
data — **do not process or demo it**.)

**Not backed up, deliberately:** `node_modules/`, `MASTER/` (gitignored; holds citizen
documents), `out/`, the Whisper and Ollama model caches.

---

## 7. If you do only one thing

Put a real 7/12 extract through `node src/extract.cli.js land <path>`.

That single command answers the only question the whole architecture rests on, and nobody
has run it.
