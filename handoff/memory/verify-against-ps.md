---
name: verify-against-ps
description: Check every plan against the PS 19 wording before proposing it; the user reads the PS literally and argues interpretation
metadata:
  node_type: memory
  type: feedback
  originSessionId: bd54e3e1-fa21-4b18-a365-41d52a798385
  modified: 2026-11-13T18:08:35.302Z
---

Before proposing a plan or feature, check it phrase-by-phrase against the PS 19 MVP line: "multilingual voice-and-chat form filling with automated pre-submission OCR validation". State which phrase each piece covers and flag any gap.

**Why:** On 2026-11-13 the user repeatedly caught interpretations that drifted from the PS — Marathi chosen before Hindi without anyone deciding, "automated" read too narrowly (user: automated = seamless, no extra step for senior citizens), and a separate website nobody asked for. That pushback drove the pivot from WhatsApp bot to CSC-operator Chrome extension. Their standing ask: "verify against the PS", "any gaps?".

Also 2026-11-13: the extension was built and tested against a mock portal copied from a photo the user happened to share; nobody picked the real target form, and it didn't match the EWS rulebook. The user: "the whole thing is pointless if its not curated around a real site" — they had expected this to be the first question.

**How to apply:** For anything that plugs into an outside system (a government portal, an API), name the real target first and get it confirmed before planning the build; a mock is only a stand-in for a target that's been chosen. Include a short PS-coverage table (as in BUILD_PLAN_EXTENSION.md) in every plan. Never let an unstated choice become a fact — surface it as a decision. Related: [[project-is-hackathon-demo]], [[prefers-direct-answers]], [[delegate-all-building]].
