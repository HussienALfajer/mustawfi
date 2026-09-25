# 0005. Clients are offline-first: local database, outbox sync, append-only documents

- Status: Accepted
- Date: 2026-09-25

## Context

Power and internet in Syria are intermittent. A shop cannot stop selling because a connection dropped, and several devices sell concurrently in different sections.

## Decision

Every client keeps a local database and writes operations to an outbox delivered idempotently to the server. Documents (invoices, vouchers, shifts, tickets) are append-only and numbered with a device prefix, so they never conflict. Master data (products, prices, permissions, settings) is server-authoritative and flows down. Stock driven negative by offline sales is flagged for the accountant and never blocks a sale. Devices receive a signed configuration bundle and may run offline up to the license's maximum offline days. Every device shows its sync state.

## Consequences

- Sync is the hardest engineering area. It gets its own spec unit and a simulation test harness (many devices, long outages, retries) before the beta.
- Reports shown online must reveal each device's last sync, so partial data isn't mistaken for complete data.
- Some checks (credit limit, stock) are best-effort offline and are reconciled after sync.

## Alternatives considered

- **Online-only clients** — unusable during outages; the main weakness of cloud competitors.
- **A LAN server inside each shop** — extra hardware and administration per store; may be revisited later as an optional hub.
- **Two-way merge of editable documents** — conflict-prone, and unnecessary when documents are immutable.
