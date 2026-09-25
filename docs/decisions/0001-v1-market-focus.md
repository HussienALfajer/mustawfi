# 0001. Focus V1 on single-branch Syrian stores, with phone shops and supermarkets as launch verticals

- Status: Accepted
- Date: 2026-09-25

## Context

The Syrian market has many accounting tools: legacy desktop programs, cheap local cloud tools, and regional generalists. A generic "for every sector" product would compete on price alone. The founding insight is a store with several sections and staff whose results must consolidate at the owner and the main accountant. Mobile phone shops embody this (repairs, accessories, carrier top-ups), and no competitor serves their workflows in depth.

## Decision

V1 targets single-branch small and medium Syrian stores. It launches with two vertical packs — mobile phone shops (primary) and supermarkets (secondary) — on top of a generic retail core. Multi-branch and enterprise needs are designed for but not built.

## Consequences

- Clear differentiation: sections, shifts, cash custody, phone-shop depth.
- Other sectors are served by the generic core until they earn their own pack.
- The architecture must still carry branches, larger tenants, and more modules without rework (ADR-0002 to ADR-0004).

## Alternatives considered

- **All sectors at launch** — shallow everywhere, price-driven competition.
- **Phone shops only** — a narrower market for first sales; supermarkets are a large, simple segment worth a light pack.
