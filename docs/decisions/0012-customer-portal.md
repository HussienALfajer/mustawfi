# 0012. The V1 customer portal is limited to receipt-driven pages behind a separate public API

- Status: Accepted
- Date: 2026-09-25

## Context

Store customers repeatedly ask whether their device is repaired, lose thermal receipts, and dispute warranties and debts. A self-service price checker was considered, but merchants who negotiate prices may not want public prices, merchants won't maintain product content, in-browser camera scanning is unreliable (no BarcodeDetector on iOS Safari), and public prices invite scraping by competitors.

## Decision

V1 ships public pages opened from a QR code printed on receipts: repair tracking, a permanent digital receipt, warranty lookup, and a customer statement via a signed link. They are served by a separate read-only public API with unguessable signed tokens, an allowlist of public fields per entity (never cost or exact stock), rate limiting, store branding, and per-page merchant switches. Product pages and a catalog come after launch, with an "ask the seller" option instead of a price; a shared phone-specifications library may later solve the content problem.

## Consequences

- Fewer "is my phone ready?" calls, and a professional image for the merchant.
- The public API layer exists early, so catalog and storefront work later is additive.

## Alternatives considered

- **In-browser price scanner in V1** — low usage, merchant resistance, unreliable on iPhone, exposes prices.
- **No customer-facing pages** — misses a cheap, high-value feature.
