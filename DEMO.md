# Demo guide

The extension helps a CSC operator check documents and fill a government form. It never submits.

## 1. Before going on stage

- [ ] Run `desktop\start-assistant.cmd`. Or start the parts by hand: `ollama serve`, `python stt/server.py`, `npm start`.
- [ ] Warm the AI. Cold start is about 53 seconds. Run one extraction first:
  `node src/extract.cli.js identity "C:/Users/gurav/Downloads/Adhhar eg/1.jpeg"`
- [ ] Reload the extension on `chrome://extensions`.
- [ ] Check `chrome://extensions/shortcuts`. Another extension may hold a key.
- [ ] Open `http://localhost:3000/portal-ews.html`.
- [ ] Check that `MASTER/` has the demo client.
- [ ] Phone hotspot is ready in case venue Wi-Fi fails.
- [ ] Backup recording is on the desktop (see section 4).

## 2. The 3-minute demo

All steps run on `portal-ews.html`.

1. **Fill the form.** Press Ctrl+Shift+F and pick the client.
   - A validation summary appears in Marathi, and the form fills.
   - Point out the colours:
     - Green: filled.
     - Amber: the operator types this from the paper.
     - Dashed amber: check the spelling. It is a machine transliteration.
   - The district, taluka and village dropdowns fill in sequence.
2. **Catch the mismatch.** The validator finds that the Aadhaar and the 7/12 belong to different people.
   - Say: "This is what gets applications rejected."
3. **Voice into a field.** Click the caste field. Press Alt+Shift+V and speak.
   - Show the transcript. Correct it by typing. Press Enter to insert.
   - Say: "Nothing unconfirmed reaches a government field."
4. **Upload capture.**
   - Upload a PNG into the Income proof slot. A wrong-format warning appears. Click Convert to JPEG in the pop-up.
   - Upload the 7/12 into Address proof. It is identified and checked automatically.
5. **Compress.** Press Alt+Shift+Z and compress a PDF to under 500 KB.
6. **Never submits.** The operator presses Submit. The extension does not.

## 3. Judge questions: honest answers

**How do you handle Aadhaar?**
It is processed locally and never transmitted. Only the last 4 digits are kept. We do not contact UIDAI.

**Why does voice mishear Marathi?**
It uses a small open model. Numbers and short fixed words are reliable. Content words are not. So every value is shown and confirmed before it goes into a field. Bigger is not better here: the medium model was 70 times slower and worse.

**Do you detect forged documents?**
No. We check consistency, completeness and validity. These are the causes of real counter rejection. We do not check authenticity. That needs database integration, which is what this plugs into.

**Why not use an LLM to decide?**
An LLM has no clock, is not deterministic, and cannot be unit-tested. The AI only reads. The rules are plain code.

**What about other scripts, like Hindi or English names?**
The model turns other Indic scripts into Devanagari. Those fields are flagged "check spelling".

**Why only some forms?**
We chose accuracy over coverage. Each form is one JSON file, so adding a form is a small job.

## 4. Backup recording

Before the pitch, record the full demo once with Win+Alt+R (Xbox Game Bar). Keep the file on the desktop. If the venue network or the AI fails, play it.

## 5. Closing line

"The AI never decides eligibility. It only reads. Every decision is deterministic code you can audit line by line."
