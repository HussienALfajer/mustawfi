# 0018. Money is exact decimal everywhere; ledger amounts at the currency's minor unit; half-up rounding at named points with explicit rounding lines

- Status: Accepted
- Date: 2026-09-25

## Context

ADR-0007 fixes the currency model and leaves representation and rounding to this phase. The rules must hold on the server (PostgreSQL), in offline clients (TypeScript over SQLite, which has no decimal type), and on the wire. Prices and costs need more precision than cents (weighted average cost, cost per piece from a carton price), and exchange rates between USD and the new SYP are large in one direction and tiny in the other. Accountants must see statements that add up exactly as displayed.

## Decision

**Representation**

- In TypeScript, amounts are never `number`. `packages/kernel` provides `Decimal` (a thin wrapper over `decimal.js` that forces an explicit rounding mode on every rounding call), `Money` (amount + currency), `Quantity` (amount + unit), and `ExchangeRate`. Lint rules ban `parseFloat`, `Number()` on amounts, `toFixed`, and `Math.round` in domain code.
- On the wire, amounts are canonical decimal strings (`"1250.50"`), validated by Zod schemas that check format and scale.
- On the server, `numeric` columns. On SQLite, `INTEGER` values scaled by the column's fixed scale, so local sums (shift totals, cash counts) are exact; conversion happens only in the local-db repository layer through kernel helpers.

**Precision**

| Kind | PostgreSQL | SQLite scale | Rule |
|---|---|---|---|
| Document and journal amounts | `numeric(20,4)` | ×10⁴ | Value always rounded to the currency's minor unit (2 for USD and SYP); the extra scale is room for future 3-decimal currencies |
| Unit prices and costs | `numeric(20,6)` | ×10⁶ | Not rounded until they become a line amount |
| Quantities | `numeric(20,4)` | ×10⁴ | Covers grams and unit conversions |
| Exchange rates | `numeric(20,6)` | ×10⁶ | Always quoted as *units of the quote currency per 1 unit of the other* — for the SYP/USD pair, SYP per 1 USD — whatever the tenant's base currency. Never stored inverted |
| Percentages (discounts) | `numeric(9,4)` | ×10⁴ | |

A currency's minor units live in `core.currency` data, not in code.

**Rounding**

- Mode: **half away from zero** ("half-up" for positive numbers), so a reversal is the exact negation of the original.
- Rounding happens **only at named points**, never in intermediate steps:
  1. a line amount (quantity × unit price − line discount) → the currency's minor unit;
  2. a conversion between currencies → the target currency's minor unit (SYP → USD divides by the rate);
  3. an invoice's payable total → the cash-rounding step of the payment currency (a `core.currency` setting); the difference is an explicit **cash rounding** line on the document, posted to a *rounding differences* account and never mixed with discounts;
  4. posting to the ledger → each line's base-currency amount rounded to the minor unit; any residual from conversions is an explicit rounding line to the same account, bounded (at most half a minor unit per converted line) — a larger residual is a defect and fails the posting.
- Splitting an amount (an invoice discount across lines, a payment across currencies) uses largest-remainder allocation, so the parts always sum exactly to the whole.

**Invariants protected by property-based tests:** rounded lines plus the rounding line equal the total exactly; an allocation's parts sum to the whole; a reversal mirrors its original to the last digit; every journal entry balances in the base currency.

## Consequences

- Statements and trial balances add up as displayed; rounding differences are visible and auditable in their own account.
- Every amount crossing a boundary (API, SQLite, UI) goes through kernel conversions; that is deliberate friction.
- The cash-rounding step for the new SYP (5? 10? 50?) is a `core.currency` default decided in the `core-money` spec session with the advisor accountant.

## Alternatives considered

- **Integer minor units (bigint cents) everywhere** — simple, but prices, costs, and rates need more precision, so different scales would be juggled by hand in every multiplication.
- **Four decimals in the ledger** — statements shown at two decimals would not add up in front of the accountant.
- **Banker's rounding (half-even)** — less statistical bias, but looks wrong to merchants (2.5 → 2) and generates support calls.
- **Absorbing cash rounding into discounts** — mixes automatic rounding with manual discounts in reports and permission limits.

## Amendments

- 2026-09-27 (`core-foundation` QA slice 23, accepted by the user on 2026-09-27, who delegated the decision): **ranges that reach a device.** SQLite keeps each value as a signed 64-bit integer at the scale of the table above, which holds less than the PostgreSQL column: below about 9.2 × 10¹² at ×10⁶ (prices, costs, rates), below about 9.2 × 10¹⁴ at ×10⁴ (amounts, quantities, percentages). One value beyond that in a pulled row fails its page on every device, and every pull after it (found in QA: an ISBN scanned into a product's price).
  - Every value that flows to devices (pulled rows, bundle parts) or is created on one is bounded where it is accepted — the request schema and a database `CHECK` — to whole digits before the point: **at most 12 at ×10⁶** (below 10¹²) and **at most 14 at ×10⁴** (below 10¹⁴). The PostgreSQL types stay as above; values only the server holds (ledger totals, reports) keep the column's range.
  - Local sums stay exact: a sum that would leave the 64-bit range is an error on the device, never a wrapped value, and is a defect to fix at its source.
  - First case: product prices (`PRICE_INTEGER_DIGITS` in `inventory/shared`, check `products_price_fits_devices`).
