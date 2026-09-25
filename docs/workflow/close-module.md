# Workflow: close a spec unit

Run once, after the unit's last slice is done.

## Check the whole unit

The unit's change set runs from its base commit (the `Unit base commit` line in the spec changelog) to the current `main`.

- Every acceptance criterion in the unit spec holds, shown by checks that ran.
- A fresh-context conformance review of that change set against the spec and the non-negotiables (`docs/workflow/review.md`), plus a correctness review of the unit's code paths.
- Project verification passes on `main`.

## Reconcile the documents

- The unit spec describes what was actually built; status *Done*; changelog entry.
- ADRs affected by the work are updated or superseded; new terms are in `docs/glossary.md`.
- `docs/roadmap.md` marks the unit *Done*.

## Keep the agent setup lean

- Fold lessons from this unit into `AGENTS.md` → Domain gotchas: one line per mistake that repeated or that a review caught.
- Remove instructions that are stale, redundant, or that agents already follow without being told. Keep `AGENTS.md` plus `CLAUDE.md` well under 200 lines together.
- If the same prompt was typed repeatedly, propose a skill; if something had to happen every time, propose a hook. Propose — don't restructure the setup without the user's approval.

## Finish

Commit (`docs(<unit>): close`) and report per `AGENTS.md`. The next step is the spec session of the next unit in `docs/roadmap.md`, or the launch gates when no unit remains.

**Done when:** all acceptance criteria hold, documents match reality, the roadmap is updated, setup proposals are reported, and everything is committed.
