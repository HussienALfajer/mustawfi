# 0008. Signed licenses with a graduated lifecycle; perpetual licenses carry annual maintenance

- Status: Accepted
- Date: 2026-09-25

## Context

Stores buy on different terms: monthly, quarterly, annual, arbitrary periods, or one-time. Unpaid subscriptions must stop being served, but cutting off a cashier mid-sale harms the merchant and the brand, and the data belongs to the merchant. Devices work offline, so enforcement can't rely on the server alone. A one-time sale of a hosted product turns into a loss over time.

## Decision

- License types: periodic of any duration, fixed term, trial, and perpetual. Duration is data, not code.
- A perpetual license includes one year of hosting, support, and updates; afterwards annual maintenance (15–25% of the license price) is required for updates and support.
- Subscriptions and payments are separate records. The balance due is computed from invoices and payments; partial payments are allowed; recording a payment extends the license automatically.
- Lifecycle: active → expiring (reminders at 14, 7, 3, and 1 days and on expiry, shown to the tenant admin only) → grace (configurable per tenant) → read-only (view and export, no new documents) → suspended → archived after 6–12 months with prior notice. Admins can grant a temporary extension with a reason.
- Transitions never happen mid-shift; they apply at shift close or at a scheduled time.
- Export is always possible; data is never deleted automatically.
- Each device holds a signed license and may work offline up to its maximum offline days; clock tampering is detected.

## Consequences

- License issuance and verification keys are part of the Phase A2 decisions.
- The admin console owns plans, invoices, payments, and lifecycle automation.
- Enforcement beyond the signed license stays light; the real leverage is that sync, remote reports, and support stop.

## Alternatives considered

- **Hard cutoff at expiry** — harms the merchant, damages reputation, looks like holding data hostage.
- **Heavy anti-tamper DRM** — costs more than it protects.
- **Perpetual with nothing after year one** — every perpetual customer becomes a loss.
