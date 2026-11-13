---
name: discuss-before-solution
description: "Should I build X?" with a finished design is not discussion — explore the problem and options with the user before forming a solution
metadata:
  type: feedback
---

For any design question (how a feature behaves, where it lives, what rule it follows), discuss the problem with the user before proposing a solution. Lay out the situation, the cases, the options and their trade-offs, and ask what they think. Presenting a complete design and asking "should I build it?" is not discussion; it is deciding and asking for a rubber stamp.

**Why:** On 2026-11-14 the user counted at least 6 rebuilds caused by undiscussed decisions: name-checking against a stored client, then Aadhaar as the anchor, then the form, each rebuilt; voice hints from documents; a tray icon instead of the expected desktop window; the mock portal; the single big panel. The user: "asking 'should I build the solution' without discussing the solution isn't the same as discussing."

**How to apply:** When a gap or bug implies a design choice, first describe the problem and the options, then ask for the user's view. Propose a recommendation only after that exchange, and build only after agreement on the rule. Pure bug fixes that follow an already-agreed rule can go straight to building. Related: [[prefers-direct-answers]], [[delegate-all-building]], [[verify-against-ps]].
