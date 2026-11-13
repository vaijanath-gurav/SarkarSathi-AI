---
name: sample-watermark-always
description: "Any edited or synthetic image in an official document format must carry a visible SAMPLE watermark — never remove it, not even for a test"
metadata:
  node_type: memory
  type: feedback
  originSessionId: bd54e3e1-fa21-4b18-a365-41d52a798385
  modified: 2026-11-13T17:50:25.105Z
---

Every edited or generated image that uses a real government document format (7/12, Aadhaar, income certificate, etc.) must be clearly marked SAMPLE — red frame, "SAMPLE · नमुना · NOT A REAL RECORD" tags, and a diagonal "SAMPLE / नमुना — NOT A REAL RECORD — SOFTWARE TEST ONLY" watermark. Never produce an unwatermarked version, including temporary diagnostic copies. Data on such images is invented, and ID numbers are zeros.

**Why:** The user said so on 2026-11-13 when I filled a blurred public 7/12 sample with invented values: "be very careful to mark this as sample though this is still an official document format", then "never remove the watermark". I had made one unwatermarked diagnostic render and had to delete it.

**How to apply:** Put the watermark on every render, including test variants and crops. If the watermark is suspected of affecting extraction, don't test without it; tell the user. (Measured: it doesn't affect extraction.) Include this rule in any subagent brief that touches sample images. Related: [[project-is-hackathon-demo]], [[delegate-all-building]].
