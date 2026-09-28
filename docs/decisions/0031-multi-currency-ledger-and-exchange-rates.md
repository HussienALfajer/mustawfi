# 0031. Multi-currency ledger: subject dimension, transaction amounts on lines, weighted-average carrying of foreign balances, append-only rates, a lock date

- Status: Accepted (by the user on 2026-09-28)
- Date: 2026-09-28

## Context

ADR-0006 fixes one double-entry ledger per tenant, ADR-0007 the currency model, ADR-0018 the representation and rounding of money, and ADR-0020 posting on the server and late documents. The walking skeleton built the ledger for the base currency only: a flat list of three accounts, lines in the base currency, no period lock, no reversal. The `core-money` spec session (2026-09-28) settled the business rules that the rest of the ledger now needs:

- V1 handles the Turkish lira (common in northern Syria) besides the new Syrian pound and the US dollar, as a transaction currency; the base currency stays SYP or USD (ADR-0007).
- One rate per foreign currency, changed whenever the owner wants, effective from the moment it is set, settable on a device while it is offline.
- Customers, suppliers, and cash boxes do not each get an account in the chart; they are a dimension on the lines of control accounts.
- Realized exchange differences are computed automatically at the weighted-average rate of each foreign balance; no revaluation of unrealized differences in V1.
- A period is closed by a lock date that only the owner can move back, with a reason.

Some of these choices shape the ledger's tables and interface for every later module (treasury, customers, purchases, sales), so they are recorded here.

## Decision

**Exchange rates**

- A rate is an append-only record: a currency pair, the rate, `effectiveAt` (the time it was set, device time when set offline), who set it and on which device. The current rate of a pair is the one with the latest `effectiveAt` (ties broken by id). A rate set offline arriving after a newer one becomes history only; the documents that used it keep it.
- A tenant sets one rate per enabled foreign currency, against its base currency. Each pair is quoted in one fixed direction: units of the weaker currency per 1 unit of the stronger, from a strength order in `core.currency`'s catalog (USD, then TRY, then SYP). For the SYP/USD pair that is SYP per 1 USD, as in ADR-0018, whatever the base. Never stored inverted.
- A conversion between two foreign currencies uses their two rates against the base: the amount is multiplied and divided exactly and rounded once, to the target currency's minor unit (ADR-0018 named point 2). Never two roundings through the base.
- Documents record the rates they used (non-negotiable 7); the ledger never looks a rate up for a document.

**Journal lines**

- A line carries its **transaction currency**, its **transaction amount**, the **rate** used (pair and value; none when the currency is the base), and its **base amount** as debit or credit. An entry balances in the base currency (ADR-0006). The conversion residual is an explicit rounding line (ADR-0018 named point 4).
- A line may carry a **subject**: a type registered by a module (`customer`, `supplier`, `cashBox`, …) and an id. The ledger never reads the subject's table; the owning module registers its type and a lookup. An account may require a subject (receivables require `customer`) and may be **currency-tracked** (cash, receivables, payables, deposits): its balance is kept per subject and per currency.

**Weighted-average carrying of foreign balances**

- For each currency-tracked account, subject, and foreign currency, the ledger keeps the balance in that currency and its base value, which are exactly the sums of the lines on that key.
- A line that increases the balance adds its transaction amount and its base amount at the document's rate.
- A line that reduces it is relieved at the balance's average rate: base relief = base value × amount ÷ currency balance, rounded half away from zero to the base minor unit; a line that clears the balance to zero relieves the whole base value exactly. A line that crosses zero is relieved up to zero and the remainder opens a new balance at the document's rate.
- The difference between the line's base amount at the document's rate and its relief is posted by the ledger, in the same entry, to the **exchange differences** system account (gain or loss), with the line's department. The entry stays balanced.
- Order is the order of posting on the server, not the business date: a late document is relieved at the average when it arrives.
- A reversal is the exact negation of every line of the original, the exchange-difference and rounding lines included, with the same base amounts; it updates the carried balances by the same negated amounts and computes no new difference. An entry is reversed at most once; a reversal is not reversed.
- Unrealized differences (revaluation of open foreign balances at a period end) are not posted in V1. Reports show foreign balances in their currency and, for information, at the current rate.

**Chart of accounts**

- A tree: group accounts (not posted to) and posting accounts, with hierarchical numeric codes. A tenant's chart is seeded at creation from a sector template that assigns the system keys the V1 units need; later units may add system keys by migration.
- An account is archived, never deleted; a system account is never archived.

**Period lock**

- A tenant has one **lock date**, with its history. No journal entry may carry an accounting date on or before it; the database refuses it.
- Advancing the lock date needs every active device to have reported pushing everything up to the end of that date (ADR-0020); otherwise the lock is refused with the list of devices.
- Moving the lock date back (reopening) needs an owner-only permission and a reason, and is audited. Posted entries stay immutable whatever the lock date.
- A device document dated on or before the lock date is posted on the first open day and flagged (ADR-0020). An entry created online (manual entry, reversal) with a locked date is refused.

## Consequences

- Customer, supplier, and cash-box balances and statements come straight from the ledger, in the base currency and in the account's own currency, with no per-party accounts to create or keep in step.
- The ledger now owns more logic (conversion, carrying, exchange differences) and needs property tests for it: every entry balances; a carried balance equals the sum of its lines; a balance brought to zero in its currency has zero base value; a reversal mirrors its original to the last digit.
- Carried balances are updated under a row lock in the posting transaction; posting is already serialized per operation on the server (ADR-0020), so the lock stays uncontended in practice.
- Treasury, customers, and purchases post foreign-currency movements with a subject and let the ledger compute the difference; they never compute exchange differences themselves.
- The Turkish lira is a transaction currency only. A northern store that thinks in lira chooses the dollar as its base.

## Alternatives considered

- **An account per customer, supplier, and box** (common in Arabic accounting software) — familiar to accountants, but it creates hundreds of accounts, couples the customers module to the chart, and the tree view can show subjects under their control account anyway.
- **Matching each payment to its invoice for exchange differences** — exact per invoice, but merchants take payments on account, not per invoice, and the matching would be a feature of its own.
- **Exchange differences entered by the accountant** — contradicts the V1 scope ("computed automatically").
- **Rates quoted against the base in both directions** — a USD-base tenant would enter 0.0082 USD per SYP; the fixed weaker-per-stronger direction keeps the numbers merchants actually say.
- **A daily rate fixed for the business day** — misses intraday moves, which merchants follow.
- **Monthly period records** — more structure than a single store needs; a lock date with history gives the same control.
- **Turkish lira as a possible base currency** — would amend ADR-0007 and keep the books in a fast-losing currency.
