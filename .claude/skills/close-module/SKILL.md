---
name: close-module
description: Close a finished Mustawfi spec unit — whole-unit review, documents reconciled, agent setup kept lean.
argument-hint: <spec-unit>
disable-model-invocation: true
effort: medium
---

Spec unit: $ARGUMENTS

Close this unit as defined in `docs/workflow/close-module.md`.

In Claude Code:
- Whole-unit conformance review: delegate to the `spec-reviewer` subagent with the unit, "whole unit", and the `Unit base commit` from the spec changelog.
- Correctness review: run the bundled `/code-review` with the unit's module directories as its path target.
- The **الخطوة التالية** line: `جلسة جديدة ← /effort high ← /module-spec <next unit from docs/roadmap.md>`, or the launch-gates checklist when no unit remains.
