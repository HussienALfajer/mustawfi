# 0007. Currency model: fixed base currency, per-document rate, per-account currency, legacy ÷100 import

- Status: Accepted
- Date: 2026-09-25

## Context

Syria redenominated its pound on 2026-01-01 (÷100); old notes lost legal tender on 2026-07-31. Much retail is priced in USD and sold in SYP at a daily rate the merchant sets, and debts are often kept in USD.

## Decision

- The tenant's base currency (new SYP or USD) is chosen at creation and never changes.
- The owner sets a daily exchange rate; history is kept.
- Items can be priced in USD or SYP and are converted at sale time.
- Every document stores its currency and exchange rate.
- Customer and supplier accounts each have their own currency.
- One invoice can be paid in several currencies; change is given in SYP; cash boxes are per currency.
- Amounts round to the smallest circulating denomination by a configurable rule.
- Realized exchange differences are computed and posted automatically.
- Imports from legacy systems offer an explicit old-pound ÷100 conversion.

## Consequences

- Money representation and rounding precision must be decided carefully in Phase A2 (no floating point).
- Every report states its currency and the rate basis.
- Bulk re-pricing after a rate change is needed (supermarket pack).

## Alternatives considered

- **SYP only** — contradicts how merchants actually price and lend.
- **Changeable base currency** — rewrites history; unacceptable for an audit trail.
