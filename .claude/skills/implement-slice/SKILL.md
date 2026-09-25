---
name: implement-slice
description: Build one slice of a Mustawfi unit spec end to end — implement, verify, review, update the spec, ship.
argument-hint: <spec-unit> <slice-number>
disable-model-invocation: true
---

Spec unit: $0 · Slice: $1 · Current effort: ${CLAUDE_EFFORT}

First, open `docs/product/modules/$0.md` and find slice $1's recommended effort. If ${CLAUDE_EFFORT} is lower, stop and reply with one line — `/effort <level>` then `/implement-slice $0 $1` — which replaces the usual report. If it is higher, say so in one line and continue.

Note the slice's base commit (`git rev-parse HEAD` on `main` before branching).

Then follow `docs/workflow/implement-slice.md`.

In Claude Code:
- Conformance review: delegate to the `spec-reviewer` subagent with the unit, the slice number, and the slice's base commit.
- Correctness review: run the bundled `/code-review` on the diff.
- Keep full test runs and long logs out of the main context (subagent or filtered output).
- The **الخطوة التالية** line: `جلسة جديدة ← /effort <next slice effort> ← /implement-slice $0 <next>`, or `جلسة جديدة ← /effort medium ← /close-module $0` after the last slice.
