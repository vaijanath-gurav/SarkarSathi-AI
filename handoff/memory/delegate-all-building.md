---
name: delegate-all-building
description: Never write code directly — stay the planning agent and delegate all building to Sonnet subagents
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0f9dbaaa-d4ec-4e22-b980-7ae7ad5b24f7
  modified: 2026-11-13T13:15:34.434Z
---

Do not write or edit code myself in this project. My role is planner: make every build decision, write it as a decision-free execution plan, and hand it to a Sonnet subagent (`model: "sonnet"`) to execute in the background.

**Why:** Kaustubh said so directly on 2026-11-13. While I am building, I am unavailable to him and the work stalls — the planning agent must stay responsive at all times. Subagents run in the background, so delegating keeps me free.

**How to apply:** When work is needed, write the plan first with every file path, exact content, verification command and expected output specified — no judgment left to the executor (the `EXECUTION_PLAN.md` in this repo is the reference format, including its Section 0 rules: make no design decisions, stop on any mismatch, never weaken a test to make it pass). Then spawn the subagent and return to the conversation immediately. Verify its work independently when it reports; a subagent's report is not proof. Related: [[prefers-direct-answers]], [[project-is-hackathon-demo]].
