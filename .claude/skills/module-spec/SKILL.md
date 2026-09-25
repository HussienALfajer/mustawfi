---
name: module-spec
description: Spec session for one Mustawfi spec unit — interview the user and write an implementation-ready unit spec with a sliced plan.
argument-hint: <spec-unit>
disable-model-invocation: true
effort: high
---

Spec unit: $ARGUMENTS

Run the spec session for this unit as defined in `docs/workflow/module-spec.md`. The unit's modules are listed in `docs/roadmap.md`.

In Claude Code:
- Ask with the AskUserQuestion tool: up to four related questions per call, in Arabic, recommended option first with a one-line reason.
- Survey existing code, if any, through the Explore subagent.
- The **الخطوة التالية** line: `جلسة جديدة ← /effort <slice 1 effort> ← /implement-slice $ARGUMENTS 1`.
