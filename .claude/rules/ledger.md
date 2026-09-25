---
paths:
  - "core/ledger/**"
  - "core/currency/**"
  - "**/*posting*"
  - "**/*journal*"
---

# Ledger and posting rules

Sources: ADR-0006 (one ledger, double entry), ADR-0018 (money and rounding), ADR-0020 (posting on sync), non-negotiables 5, 6, 7, 9.

- One ledger per tenant. Departments are a dimension on journal lines, never separate books. Other modules post only through `core.ledger`'s public posting interface (slice 7 names it), never by writing its tables.
- Every entry balances in the base currency: sum of debits = sum of credits, exactly. An unbalanced entry is refused, not "fixed". Keep the property test that posts random sequences and checks the balance.
- Posted entries are immutable. Corrections are reversing entries that mirror the original to the last digit. The application role has no `DELETE` on ledger tables and triggers refuse `UPDATE` of posted rows — keep the database test for this.
- Amounts are `Money`/`Decimal` from `packages/kernel`, never `number`. Round only at ADR-0018's named points, half away from zero. A conversion residual becomes an explicit line to *rounding differences*, at most half a minor unit per converted line; a larger residual fails the posting.
- Each line carries its currency and its department; the exchange rate is recorded on the document (non-negotiable 7).
- Period locks apply to the `accounting_date`; the document keeps its `business_date`. A late document dated in a locked period posts on the first open day and is flagged.
- Posting rules run on the server only. The device keeps display balances; the server's values replace them after sync.
