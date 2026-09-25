# 0006. One double-entry ledger per tenant; departments are profit centers; corrections by reversal

- Status: Accepted
- Date: 2026-09-25

## Context

The core idea is sections working independently while everything consolidates at the main accountant. Separate books per section, merged later, would disagree and could not be audited.

## Decision

Each tenant has exactly one ledger. Every financial event posts balanced journal entries through the ledger module. Departments are a dimension on journal lines (profit centers), each with its own cash box and optional stock location. Posted documents are immutable; corrections are reversing entries; closed periods are locked. The chart of accounts comes from a sector template and stays editable.

## Consequences

- Per-department profit and cash position come straight from the ledger.
- The ledger is the most critical code: property-based tests (random operation sequences keep debits equal to credits) and invariant tests are mandatory.
- Everyday users never see journal entries; accountants can.

## Alternatives considered

- **Separate books per department, merged centrally** — reconciliation problems by design.
- **Single-entry cash book** — cannot grow into real accounting or pass a professional audit.
