# Workflow: review criteria

Used for slice reviews, unit closes, and any review before merge. The reviewer sees the diff, the spec, and the non-negotiables — not the reasoning that produced the change.

## Blocking findings (report only these as blocking)

1. A non-negotiable in `AGENTS.md` is violated or weakened (tenant isolation, ledger balance, immutability, offline sale path, audit, numbering, period lock…).
2. An acceptance criterion of the slice or unit is not met, or the change goes outside the slice's scope.
3. A correctness bug with a concrete failing scenario.
4. A security or data-loss risk: missing tenant context, missing permission check, secrets in code, destructive migration.
5. New behavior or a touched invariant without a test that would catch its failure.
6. A module reaching into another module's tables or internals.

## Format

For each blocking finding: file and line, why it is wrong, and how to show it fails (input, state, expected vs. actual).

Then list each acceptance criterion with the evidence that it holds (test name, command output) or "not shown".

Non-blocking notes: at most five, one line each.

## Don't

- Report style preferences or hypothetical problems as blocking.
- Ask for abstraction layers, defensive code, or tests for cases that can't happen.
- Re-litigate accepted ADRs; flag a suspected problem as a non-blocking note with evidence.
