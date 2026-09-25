# Product vision

Status: Accepted · Last reviewed: 2026-09-25

## Product

**Mustawfi (مُستوفي)** — cloud accounting and point of sale for Syrian retail, by **Vertex System**.

The name is the historical title of the state's chief accountant in Islamic administrations; in Arabic, *istawfā* means "to collect a due in full". It fits a small shop today and an enterprise tomorrow.

## Who it is for (V1)

Single-branch small and medium stores in Syria, across retail sectors, with two launch verticals:

1. **Mobile phone shops** (primary) — typically three sections under one roof: repairs, accessories/devices, and carrier top-ups (Syriatel, MTN) plus e-wallet agent services.
2. **Supermarkets and groceries** (secondary) — fast barcode checkout, weighted items.

The generic core serves any retail store.

## The problem

Several people sell and collect cash in different sections of the same shop. The owner can't see, reliably and in one place, what each section sold, what it earned, and how much cash each employee is holding — especially with intermittent internet, prices in two currencies, and much of the trade on credit.

## The promise

> The owner knows where every lira is — which section, which employee — even when the internet is down.

## Differentiators

1. **Sections that consolidate**: each section has its own users, cash box, and shifts; everything lands in one ledger and at the main accountant (shift close, cash count, handover with accountant approval).
2. **Truly offline**: every device keeps selling without the server and syncs when it can.
3. **Dollar + new Syrian pound as first-class citizens**: USD pricing, daily rate, per-document rate, accounts kept in USD or SYP.
4. **Depth for phone shops**: repair tickets, IMEI tracking, carrier-balance accounting, e-wallet agent services — which generalist competitors don't cover.
5. **Owner visibility from the phone**: live position per section and per cash box, alerts, remote approvals.

## Market context (as of September 2026 — re-verify before relying on it)

| Factor | Fact | Product consequence |
|---|---|---|
| Currency | New Syrian pound (÷100) from 2026-01-01; old notes lost legal tender 2026-07-31 | Legacy import converts ÷100 |
| Dollarization | Many goods priced in USD, often above the official rate | USD pricing, daily owner-set rate, rate stored per document |
| Electricity | Improved to 20+ hours/day in some areas in 2026, still unreliable elsewhere | Offline-first is mandatory |
| E-payments | Sham Cash (~4.2M users, accepting API integrations), Syriatel Cash, MTN Cash, Bemira local cards | Record these payment methods in V1; integrate later |
| Sanctions | Caesar Act repealed Dec 2025; Google/Apple services returning gradually (Apple still limited) | Cloud hosting and Android distribution are viable; iOS native deferred |
| Tax | The General Commission for Taxes and Fees publishes a list of approved accounting software; approval conditions not yet verified | Start the approval inquiry early; approval is a sales argument |
| E-invoicing | No Syrian mandate found (Jordan and Saudi Arabia have one) | Design immutable, sequential, auditable invoices now |
| Hardware | Windows 7 PCs still common | State Windows 10+ requirement clearly |

## Competitive landscape

| Segment | Examples | Strengths | Gaps we exploit |
|---|---|---|---|
| Syrian desktop (legacy) | Al-Ameen (SyrianSoft, ~$300–700), Al-Bayan, Al-Shamel, Al-Mizan, Al-Manara | Known to accountants, offline, perpetual license, some tax-approved | Dated UX, LAN-only, no remote owner view, on-site installs |
| Syrian cloud | Aman ERP (free tier, ~$8/$12 per month) | Cheap, SYP + multi-currency, fine permissions | Cloud-only (no offline mentioned), no vertical depth |
| Regional cloud | Wakeed (Jeddah HQ; $19/$27/$38 per month for 2/4/7 users and 1/2/5 POS; ~800 users in 7+ countries), Daftra, Qoyod, Rewaa | Mature, broad modules, offline POS (Wakeed, Daftra), WhatsApp notifications | Generalist; per-user/per-POS pricing penalizes multi-section shops; Gulf-oriented |
| Global | Loyverse (free POS; charges ~$25/store/month for employee management), RepairDesk ($99–149/month, repair-vertical), Odoo, QuickBooks, Xero | Proven patterns | Not built for Syrian currency, connectivity, or payment reality |
| Niche Syrian | Carrier top-up accounting apps | Solve one workflow | Fragmented; shops juggle several apps |

Takeaways: POS alone is a commodity; people pay for staff control and vertical depth. The Syrian market is not captured by any cloud player yet.

## Business model (hypotheses to validate in the field)

- **Price per store, not per user** — multi-section staffing is the core use case; don't tax it.
- Indicative editions: **Basic** ~$10–15/month; **Phones Pro** and **Supermarket Pro** ~$20–25/month. Annual prepay discount. Paid add-ons: extra users, sections, devices.
- **Perpetual license** available: one-time price including one year of hosting, support, and updates; then **annual maintenance of 15–25%** of the license price. Without maintenance the software keeps working but gets no new features or support.
- **Collection**: Sham Cash, cash through provincial resellers, annual prepayment.
- **Go-to-market**: resellers per governorate (installation, training, data migration), hardware bundles (thermal printer, scanner, cash drawer), WhatsApp support as a product feature.

## Long-term direction

Multi-branch, multi-company, full enterprise accounting (fixed assets, bank reconciliation, advanced cost centers), government e-invoicing when mandated, public API, storefront. V1 architecture keeps these reachable (`branch_id` everywhere, module system, entitlements).

## Key risks

| Risk | Mitigation |
|---|---|
| Offline sync corrupting data | Append-only documents, idempotent sync, heavy simulation testing before beta |
| Accounting errors destroying trust | Syrian accountant as advisor; ledger invariant and property-based tests |
| Price war with cheap/free tools | Compete on sections + offline + vertical depth, not price |
| Merchant distrust of cloud | Full offline operation, export anytime, clear data ownership |
| Competitors are tax-approved, we aren't | Start the approval process early |
| Scope creep ("every sector") | Two verticals at launch; everything else waits |
| Subscription collection | Resellers, prepaid annual plans, Sham Cash |

## Sources (for re-verification)

- Wakeed pricing and features: https://wakeed.online/faq/ · https://wakeed.online/
- Aman ERP: https://aman-erp.com/
- Approved accounting software list: https://syriantax.gov.sy/?category_id=159&page=category
- Old pound withdrawal: https://www.aljazeera.net/ebusiness/2026/7/30/ (Al Jazeera, 2026-07-30)
- Electricity 2026: https://cnnbusinessarabic.com/energy-and-sustainability/1146005/
- Payments in Syria: https://www.makook.app/blog/online-payments-syria
- Caesar Act repeal: https://www.curtis.com/our-firm/news/u-s-repeals-the-caesar-act-in-latest-move-to-ease-syria-sanctions
- Loyverse pricing: https://loyverse.com/pricing · RepairDesk: https://www.capterra.com/p/146659/RepairDesk/
