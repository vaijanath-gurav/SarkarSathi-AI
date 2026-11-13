---
name: auto-retry-downloads
description: "Restart failed downloads and installs automatically, in the background, without asking"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0f9dbaaa-d4ec-4e22-b980-7ae7ad5b24f7
  modified: 2026-11-13T11:21:24.111Z
---

When a download or install fails (npm install, ollama pull, winget), restart it immediately in the background. Do not ask first and do not wait to be told.

**Why:** Kaustubh said so directly on 2026-11-13 during a time-critical hackathon, after a flaky venue network failed the same npm install twice. Asking costs a round trip on work that has one obvious next action.

**How to apply:** Retry with resilience flags where available (`npm install --fetch-retries=10`). Always `run_in_background: true` — see [[prefers-direct-answers]] and [[project-is-hackathon-demo]]. Report the failure and the restart together in one line; don't narrate each attempt.
