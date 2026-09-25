# 0011. Mobile selling defaults to "send to cashier"; phones double as scanning and stock tools

- Status: Accepted
- Date: 2026-09-25

## Context

In phone shops the seller often stands with the customer, away from the till. Selling from a phone is valuable, but a seller collecting cash on a phone would break the cash-custody model (shifts, boxes, handovers). Phone boxes carry several barcodes, and receiving stock means capturing many IMEIs.

## Decision

- Two mobile selling modes, chosen per user or department: **send to cashier** (default — the order waits at the cashier, who takes payment) and **full mobile POS** (the seller has their own shift and cash box on the phone).
- Printing from phones: the receipt prints at the cashier, or a digital receipt goes out (WhatsApp/PDF). Bluetooth printing from phones is deferred.
- Native camera scanning in the apps, with automatic IMEI recognition (15 digits + Luhn); IMEI1 and IMEI2 are both stored; other box barcodes are classified, not mistaken for IMEIs.
- Phones are also used for sequential IMEI scanning at purchase receiving, stocktake, product and IMEI lookup, and repair intake photos.
- Phones are registered devices with PIN, auto-lock, remote revoke, and data limited to the user's scope. Main POS devices and mobile companions have separate license limits.
- In supermarkets, camera scanning serves stocktake and lookup only; checkout uses laser/HID scanners.

## Consequences

- The sales module needs an order queue at the cashier.
- Device-type limits must exist in entitlements and pricing.

## Alternatives considered

- **Phones as full POS by default** — weakens cash control, the product's core promise.
- **No mobile selling** — loses a differentiator in the primary vertical.
