# Workflow: implement a slice

Build one slice from a unit spec, end to end, in one session.

## Before starting

- Read the slice row and the spec sections it relies on in `docs/product/modules/<unit>.md`, plus the ADRs it references.
- If a slice it depends on isn't done, stop and report.
- If the current effort is below the slice's recommended effort, stop and ask the user to raise it: a single line with the exact commands, which replaces the usual report.

## Build

- Work on branch `slice/<unit>-<n>-<short-name>` (docs-only work before Phase A3 may go straight to `main`).
- For a multi-file slice, state a short plan in your first message, then proceed without waiting.
- Follow existing patterns in the codebase. Write tests alongside the code; for invariants, write the test that would fail if the invariant broke.
- Keep to the slice's scope. Record anything else under **ما وجدته**.

## Verify

- Run the project's verification (see `AGENTS.md` → Commands) until it passes. Report the commands and their results.

## Review

Review before committing, so the reviewers see the working tree against the slice's base (the commit `main` was at when the slice started).

- Conformance: a fresh-context review of the change against the spec and the non-negotiables, using the criteria in `docs/workflow/review.md`.
- Correctness: a bug-focused review of the diff.
- Fix blocking findings. List non-blocking ones under **ما وجدته**; don't chase them.

## If the slice turns out too big

Stop at a clean, green boundary, commit what is done, split the remainder into a new slice in the spec (with its own Done criteria and effort), and report.

## Ship

- In the spec: set the slice status to *Done*, with the date and any deviations from the spec. When this is slice 1, also add a changelog line `Unit base commit: <sha>` (the commit `main` was at before slice 1) and set the unit to *In progress* in `docs/roadmap.md`.
- If a mistake repeated during the session, propose a one-line gotcha for `AGENTS.md`.
- Commit with a Conventional Commits message, push the branch, open a PR, and enable auto-merge (squash); GitHub merges once `verify` passes and deletes the branch. If the slice touched a non-negotiable or an ADR, don't enable auto-merge: leave the PR for the user under **ينتظرك**.
- If CI fails, diagnose and fix it in code (at most three attempts; never weaken a test or a check), then push again. After three failures, stop and report under **ينتظرك**.
- Once merged, update local `main` and delete the local branch.
- Report per `AGENTS.md`. The next step is the next slice with its effort, or the unit's close when this was the last slice.

**Done when:** the slice's Done criteria are proven by checks, both reviews show no blocking findings, the spec is updated, and the work is merged (or waiting for the user with a stated reason).
