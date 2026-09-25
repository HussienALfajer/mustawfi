# Workflow: spec session

Turn one spec unit (listed in `docs/roadmap.md`) into an implementation-ready spec, together with the user.

## Inputs

- The unit's row in `docs/roadmap.md` and its modules' sections in `docs/product/v1-scope.md`.
- `docs/architecture/overview.md`, the ADRs that touch the unit, `docs/glossary.md`.
- Specs of units it depends on, and existing code if any.

## How to run it

- Read the inputs first. Don't ask the user about anything they already settle.
- Interview the user on the hard parts only: business rules, Syrian-market specifics, edge cases, permissions and limits, offline behavior, failure handling, what stays out of scope. Ask in Arabic, a few related questions at a time, each with a recommended option first and a one-line reason. Keep going until nothing material is open.
- When the user is unsure, propose a default with its reasoning and record it.
- A decision with architectural weight becomes an ADR with status *Proposed*; ask the user to accept it before the spec relies on it.

## Output

`docs/product/modules/<spec-unit>.md`, built from `docs/product/modules/_template.md`, in English, with every section filled or explicitly marked "none".

### Slice plan rules

A slice is one verifiable outcome that one session can finish without compacting context.

- Scope: one module's internals plus the core interfaces it uses.
- Done criteria: 3–5 conditions a check can prove.
- Size: a plan of roughly ten steps or fewer. Larger → split. Trivial related changes → merge into one slice.
- Order: data and domain rules with their tests first, then API, then UI, then offline and sync behavior — unless a thin end-to-end slice gives earlier feedback.
- Recommended effort per slice:
  - `high` — ledger, sync, tenant isolation and security, licensing, currency and money math.
  - `medium` — business logic, API, UI.
  - `low` — mechanical work (renames, wiring, copy changes).
  - `xhigh` only for a slice known in advance to be unusually deep.

## Finish

1. Update the unit's status in `docs/roadmap.md` to *Spec ready*; add any new terms to `docs/glossary.md`.
2. Show the user an Arabic summary: key rules, notable edge-case decisions, the slice list with efforts. Apply corrections.
3. After approval, commit (`docs(<unit>): spec`).
4. Report per `AGENTS.md`; the next step is slice 1 of this unit, with its effort.

**Done when:** the spec is complete, every slice has Done criteria and an effort, the user approved, the roadmap is updated, and everything is committed.
