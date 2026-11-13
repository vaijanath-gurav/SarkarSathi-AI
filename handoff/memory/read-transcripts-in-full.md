---
name: read-transcripts-in-full
description: "When learning from past transcripts, read every user message in full (never truncate), and write their requirements into the plan quoted"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1620bb3f-0390-4be7-aa7b-74d032ced084
  modified: 2026-11-13T21:32:41.709Z
---

When asked to "read the md files and transcripts and learn", read every user message in full, never truncated. Then check that each requirement the user stated appears in the plan files. If one doesn't, add it before doing anything else.

**Why:** On 2026-11-14 my extraction script cut each user message at 600 characters. That dropped the user's full feature list: one keybind per feature, a bottom pop-up UI, PDF↔text/image conversion, and upload-slot capture. Eight hours of building then drifted from what they wanted, with 8 hours left in the hackathon. The user: "i asked you to do it at the start of this session."

**How to apply:** The plan's section "00. User requirements" (BUILD_PLAN_EXTENSION.md) is the source of truth; check every phase against it. Related: [[verify-against-ps]], [[delegate-all-building]], [[prefers-direct-answers]].
