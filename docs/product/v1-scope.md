# V1 scope

Status: Accepted · Last reviewed: 2026-09-25

This is the complete list of what V1 contains. Anything not listed here is out of V1 (see §9). Module specs (`docs/product/modules/`) refine this document; they don't contradict it without an explicit, recorded change.

## 1. V1 in one sentence

A solid accounting core that works offline, in USD and new SYP, with sections, shifts, and cash boxes — plus a deep pack for mobile phone shops, a light pack for supermarkets, customer-facing receipt pages, and an admin console that controls every customer without new code.

## 2. Definition

| Item | Decision |
|---|---|
| Customer | One Syrian store (no branches), several staff in several sections |
| Launch verticals | Mobile phone shops (primary), supermarkets (secondary); the core fits any retail store |
| Language | Arabic UI only; i18n-ready so English can be added later |
| Clients | One web UI codebase shipped as a Windows app, an Android app, and a browser/PWA (see §5) |
| Hosting | Multi-tenant SaaS; offline-capable clients sync to the server |

The non-negotiables in `AGENTS.md` apply to everything below. Architecture mechanics are in `docs/architecture/overview.md`.

## 3. Module map

| ID | Module | Layer | Depends on | Can be disabled |
|---|---|---|---|---|
| `core.tenancy` | Tenant & license | Core | core.config | No |
| `core.access` | Identity, permissions, devices | Core | core.config, core.tenancy, core.audit | No |
| `core.organization` | Store profile, departments, numbering | Core | core.config, core.tenancy, core.access, core.audit, core.sync | No |
| `core.currency` | Currencies & exchange rates | Core | — | No |
| `core.ledger` | Accounting engine | Core | core.config, core.tenancy, core.currency | No |
| `core.audit` | Audit log | Core | core.config, core.tenancy | No |
| `core.sync` | Offline storage & sync | Core | core.config, core.tenancy, core.access, core.audit² | No |
| `core.config` | Module registry, entitlements, settings, custom fields, templates | Core | — (the root module; the host hands it the database) | No |
| `core.notifications` | In-app notifications, WhatsApp links | Core | core.config | No |
| `core.data` | Import/export framework (each module registers its own importers and exporters) | Core | core.config | No |
| `inventory` | Products & stock | Base | core platform¹ | No |
| `treasury` | Cash boxes, shifts, vouchers, expenses | Base | core platform¹ | No |
| `customers` | Customers & receivables | Base | core platform¹ | No |
| `sales` | Sales & POS | Base | inventory, customers, treasury | No |
| `purchases` | Purchases & suppliers | Base | inventory, treasury | Yes |
| `reports` | Reports & owner dashboard | Base | inventory, treasury, customers, sales (purchases optional) | No |
| `serials` | Devices & IMEI tracking | Phones pack | inventory, sales, purchases | Yes |
| `repairs` | Repair tickets | Phones pack | inventory, sales, customers (serials optional) | Yes |
| `recharge` | Carrier balances & e-wallet agent services | Phones pack | treasury, customers | Yes |
| `weighted` | Weighted items & scale barcodes | Supermarket pack | inventory, sales | Yes |
| `customer-portal` | Public pages for store customers | Base | sales, customers (repairs, serials optional) | Yes |
| `admin` | Super admin console (separate app) | Control plane | — | — |

¹ Core platform = `core.tenancy`, `core.access`, `core.organization`, `core.currency`, `core.ledger`, `core.audit`, `core.sync`, `core.config`. `core.notifications` and `core.data` are services modules plug into once they exist; they are not build prerequisites.

² Other modules plug their sync operations and configuration-bundle parts into `core.sync` through the host, so `core.sync` does not depend on them. Departments are stored in `core.tenancy` and managed through `core.organization` (ADR-0030). `core.audit` sits below `core.access` because access writes sign-in entries (walking-skeleton slice 6).

## 4. Features

### 4.1 Core

**`core.tenancy` — tenant & license**
- Tenant record with one hidden default branch.
- Signed license delivered to every device: plan, entitlements, limits, expiry, grace days, **maximum offline days** (default 10, per-tenant override).
- Client enforces the lifecycle: active → expiring (banner to tenant admin only) → grace → **read-only** (view and export, no new documents) → suspended → archived after 6–12 months, with prior notice. State changes never apply mid-shift; they apply at shift close or at a scheduled time.
- Data export is available in every state. Data is never deleted automatically.
- Detects device clock tampering (time moving backwards).

**`core.access` — identity, permissions, devices**
- Password login for admins and accountants; quick **PIN** login for cashiers on shared devices.
- Role templates (owner, accountant, section cashier, repair technician, top-up operator), editable.
- Permissions in three dimensions: **scope** (which departments), **action** (create, cancel, return, view cost, view profit, change prices…), **limits** (max discount %, max credit sale, max return without approval).
- **Supervisor override by PIN** on the same device when a limit is exceeded.
- Device registration and remote revoke. Device types: **main POS** and **mobile companion**, with separate limits.
- Auto-lock after inactivity.

**`core.organization` — store and departments**
- Store profile: name, logo, address, phones, tax number.
- **Departments** (e.g. repairs, accessories, top-ups): each is a profit center with a default cash box and an optional stock location.
- Document numbering per document type and per device, with a device prefix.

**`core.currency` — currencies and rates**
- Base currency chosen at tenant creation (new SYP or USD), immutable afterwards.
- Daily exchange rate set by the owner, with history.
- Items priced in USD or SYP, converted at sale time.
- Rounding rule to the smallest circulating denomination.
- One invoice may be paid in several currencies; change is given in SYP.
- Every document stores its currency and rate.
- Customer and supplier accounts have their own currency (USD or SYP).
- Realized FX differences are computed automatically.

**`core.ledger` — accounting engine**
- Chart-of-accounts templates per sector, editable.
- Automatic balanced journal entries behind every financial event.
- Manual journal entries for the accountant; opening balances.
- **Period lock**. Corrections by reversal only.
- Account ledger and trial balance.

**`core.audit` — audit log**
- Records everything listed in non-negotiable 10. Immutable, visible to the owner.

**`core.sync` — offline storage and sync**
- Local database on every device; outbox with resumable, idempotent delivery.
- Conflict rules: documents are append-only (no conflicts); master data (products, prices, permissions) is server-authoritative; negative stock caused offline never blocks a sale — it raises a flag for the accountant.
- Visible sync status on every device.
- **Signed configuration bundle** pulled on sync: license, entitlements, settings, custom-field definitions, templates, permissions.

**`core.config` — customization platform**
- Module registry with manifests and dependency validation.
- **Entitlements** = plan + paid add-ons + per-tenant overrides; checked on the server, in the UI, and on offline devices.
- **Typed settings** with a hierarchy (system default → plan → tenant) and an auto-generated settings screen.
- **Custom fields** on three entities in V1: product, customer, repair ticket. Archived, never erased.
- **Print templates**: 58/80 mm thermal receipt, A4 invoice, repair receipt, barcode label. Versioned; each document stores the version it printed with. Arabic rendered as an image for thermal printers.

**`core.notifications`**
- In-app notifications: low stock, repair ready, shift variance, license expiring (tenant admin only), device not synced for too long.
- WhatsApp via prefilled message links (statement, "your device is ready") — no WhatsApp API in V1.

**`core.data` — import / export**
- An import/export framework that each module uses for its own entities.
- V1 Excel imports: products, customers, suppliers, opening balances, each with an explicit **old-pound ÷100 conversion** option.
- Full tenant export (Excel + backup). Any report exportable to Excel and PDF.

### 4.2 Base modules

**`inventory` — products and stock**
- Product: name, multiple barcodes, category, brand, owning department, optional image.
- Units with conversions (carton → pack → piece), each with its own barcode and price.
- Three price levels: retail, half-wholesale, wholesale — each with its currency.
- Services (non-stock items, e.g. repair labor). Flags: serial-tracked (for `serials`), weighted (for `weighted`).
- Weighted-average cost; per-product movement history.
- Adjustments with a mandatory reason; stocktake (count sheet → variance posting); transfers between departments and locations.
- Minimum stock with alerts; barcode label printing; price-change log.
- Camera scanning on mobile for stocktake and lookup.

**`treasury` — cash boxes, shifts, vouchers, expenses** (the heart of the sections idea)
- Cash boxes per department and per currency, plus the accountant's main box.
- Payment-method accounts: Sham Cash, Syriatel Cash, MTN Cash, card, bank.
- **Shift**: open with a float; close with a physical count (optionally by denomination); the system computes and posts the variance.
- **Cash handover** from a shift to the main box, **approved by the accountant**.
- Receipt and payment vouchers; expenses with categories (rent, generator/amperes, salaries and advances, transport…).
- Transfers between boxes; **currency exchange** inside a box; **owner drawings**.

**`customers` — customers and receivables**
- Profile: name, phone, type (retail/wholesale), **account currency**, **credit limit**, custom fields.
- Debt ledger and statement; receipt vouchers against debt.
- Share statement via WhatsApp link; overdue debts report (oldest first).

**`sales` — sales and POS**
- Fast POS: scanner, instant search, full keyboard operation, quick-item grid for touch.
- Price level by customer type; line and invoice discounts within limits, supervisor override beyond.
- Hold and resume; split payment (SYP cash, USD cash, Sham Cash, Syriatel Cash, MTN Cash, card, credit); change calculation.
- Credit sale within the customer's limit.
- Returns: with the original invoice, or without it by special permission.
- A4 invoice for wholesale and credit sales; reprint; cancel by reversal only; cash-drawer kick through the printer.
- Every sale linked to department, user, shift, and device.
- **Mobile selling**, two modes chosen per user or department:
  - **Send to cashier** (default): the seller builds the order on a phone; the customer pays at the cashier, where the order is waiting.
  - **Full mobile POS**: the seller has their own shift and cash box on the phone.
- Digital receipt (WhatsApp/PDF) when no printer is at hand.

**`purchases` — purchases and suppliers**
- Purchase invoice (cash or credit, any currency) updating cost; purchase returns.
- Supplier account and statement in the supplier's currency; supplier payments.
- **Receiving by sequential IMEI scan** on mobile (with `serials`).

**`reports` — reports and owner dashboard**
- Sales by day, department, user, payment method; gross profit by department, product, category.
- Shift reports and variances; stock value, movement, shortages; receivables and payables; expenses by category; cash position per box and payment method; simple profit and loss; trial balance and account ledger.
- **Owner dashboard** — a set of screens granted by permission (not a separate app), the home screen on phones: today's sales and profit per department, cash per box, open shifts, alerts (large discount, cancellation, variance, drawer opened without sale), **remote approvals**, today's debts and shortages, and **each device's last sync time** so partial numbers are never mistaken for complete ones.

### 4.3 Phone shop pack

**`serials` — devices and IMEI**
- Capture IMEI/serial per unit at purchase; pick the exact unit at sale.
- Full history per unit: bought from, sold to, dates, warranty, repairs.
- Buying a used device from a customer (seller details recorded).
- Warranty per unit.
- Camera scanning with automatic IMEI detection (15 digits + Luhn), storing IMEI1 and IMEI2 and ignoring other box barcodes.

**`repairs` — repair tickets**
- Ticket: customer, device model, IMEI, reported fault, condition and accessories received, device photos, **passcode stored encrypted and visible only to the assigned technician**, estimated cost, **deposit**, expected date.
- Statuses: received → diagnosing → waiting for part → in repair → ready → delivered (or returned unrepaired).
- Technician assignment; spare parts consumed from stock; labor.
- Ticket → invoice through POS, deposit deducted automatically; repair warranty in days.
- Numbered receipt and device label; "your device is ready" WhatsApp link.
- Reports: unclaimed devices, technician productivity, repair profit.

**`recharge` — carrier balances and e-wallet services**
- Separate balance account per carrier (Syriatel, MTN), treated as an asset.
- Balance purchases from the distributor at a discount (cost).
- Quick top-up sale entry (number, amount, carrier): balance deducted, profit computed.
- Top-ups on credit go to the customer's account.
- **Daily reconciliation**: system balance vs. actual SIM balance; the difference is posted.
- E-wallet agent services (cash-in / cash-out for Sham Cash, Syriatel Cash): fee recorded as income; one balance per wallet.
- Paper recharge cards are ordinary inventory.

### 4.4 Supermarket pack

**`weighted` — weighted items and scale barcodes**
- Configurable scale-barcode format (prefix, weight-or-price, digit layout); PLU codes.
- Sale of decimal quantities by weight.
- Bulk price update by category, by percentage, or **re-pricing after an exchange-rate change**.

### 4.5 Customer portal

**`customer-portal` — pages for the store's customers**, opened from a QR code printed on receipts:
- Repair tracking (status, cost, deposit, expected date, WhatsApp button to the store).
- Permanent digital receipt.
- Warranty lookup by IMEI or receipt number.
- Customer statement through a signed link.
- Store branding on every page; the merchant turns each page on or off.
- Foundation: a separate public read-only API, unguessable signed links, an allowlist of public fields (never cost or exact stock), rate limiting.

### 4.6 Control plane

**`admin` — super admin console** (a separate app, mandatory 2FA)
1. Create a tenant and its admin account from a sector template (chart of accounts, roles, departments).
2. Dynamic plans and licenses: perpetual (with annual maintenance), periodic of any duration, fixed term, trial.
3. Invoices and payments: manual payment entry with receipt photo, partial payments, balance computed, **automatic extension on payment**, upgrade and downgrade with proration, printable invoice and receipt for the tenant.
4. Lifecycle automation: reminders at 14, 7, 3, and 1 days and on expiry; configurable grace per tenant; read-only; suspension; archiving after 6–12 months with prior notice; a **temporary extension** button with a reason.
5. Entitlements per tenant: modules, features, limits, add-ons.
6. **Support impersonation**, read-only by default, logged and **visible to the tenant**.
7. Dashboard: active, trial, suspended; expiring in 7/30 days; overdue; monthly recurring revenue.
8. Tenant card: details, subscription, payments, devices with last sync, internal notes.
9. Export any tenant's data.
10. Staff roles (owner, support, finance) and an immutable audit log of every admin action.

## 5. Platforms and devices

| Client | Technology | Use | Offline |
|---|---|---|---|
| Windows app (Windows 10+) | Tauri | Main cashier, accountant | Full |
| Android app (phone, tablet) | Capacitor | Touch POS, mobile selling, scanning, stocktake, repairs, owner dashboard | Full |
| Browser / PWA | Same UI code | Owner and accountant remotely; iPad/iPhone in V1 | Limited — not for primary POS |
| Admin console | Separate web app | Vertex System staff | Not needed |

- One UI codebase (React + TypeScript). Screen sets per form factor: desktop gets everything; tablet gets POS, repairs, inventory, reports; phone gets task-focused screens (quick sale, scanning, stocktake, receiving, repair tickets, owner dashboard, alerts).
- Native camera scanning (ML Kit) in the apps; browser scanning is not relied on.
- Android distribution through Google Play and as a direct APK installed by resellers.
- Certified hardware list: ESC/POS thermal printers 58/80 mm (USB, network, Bluetooth), HID barcode scanners, cash drawer via printer, one label printer.
- Deferred: printing from a phone to a Bluetooth printer, native iOS app, push notifications on iOS.

## 6. Editions

Limits are entitlements, adjustable per tenant from the admin console. Pricing is per store (see `vision.md`).

| | Basic | Phones Pro | Supermarket Pro |
|---|---|---|---|
| Core + base modules + customer portal | ✓ | ✓ | ✓ |
| serials, repairs, recharge | — | ✓ | — |
| weighted | — | — | ✓ |
| Departments | up to 2 | up to 4 | up to 3 |
| Users | up to 3 | up to 6 | up to 6 |
| Main POS devices | 1 | 3 | 3 |

Mobile companion devices (phones used for selling, scanning, stocktake) have a small free allowance in every edition and are priced below main POS devices beyond it.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| POS speed | Add item < 100 ms, complete sale < 1 s, with no network dependency; smooth on old hardware |
| Offline | Full operation up to the license's maximum offline days |
| Sync | Automatic, resumable, idempotent; no loss, no duplication |
| Backup | Server: continuous plus a daily snapshot per tenant, single-tenant restore. Device: local backup |
| Security | TLS; encrypted backups; RLS isolation; 2FA for admin console (optional for owners); encrypted repair passcodes |
| Language | Full Arabic RTL; Arabic or Western digits by preference; Gregorian calendar; Damascus time zone |
| Module boundaries | Enforced by tooling, not convention |

## 8. Data invariants

The ten non-negotiables in `AGENTS.md` are the V1 data invariants. Module specs add module-specific ones.

## 9. Out of V1

| Item | When | Why |
|---|---|---|
| Multi-branch UI | V2 | `branch_id` already everywhere |
| Installments | Right after launch | Plain credit covers V1 |
| Sham Cash / Bemira integration | After launch | Manual recording first |
| Expiry dates, batches | After launch | Supermarket nice-to-have |
| Promotions, loyalty | Later | |
| Purchase orders, quotations | Later | Direct purchasing is enough for small stores |
| WhatsApp API automation | Later | Prefilled links suffice |
| Form-layout editor | Later | Custom fields suffice |
| Public API, webhooks | Later | |
| Government e-invoicing | When mandated | Design is ready for it |
| HR and payroll | Later | Expenses and advances suffice |
| Manufacturing, e-commerce storefront, projects, CRM | Not planned near-term | Outside the target segment |
| Product pages / catalog in the customer portal | After launch | Merchants may not want public prices; content burden |
| Fixed assets, bank reconciliation, advanced cost centers | With larger customers | |
| Customer display, restaurant features | Later | |
| English UI | Later | i18n structure is ready |
| Reseller portal in the admin console | After launch | |
| Admin console extras: announcements to tenants, coupons, release channels, tenant health metrics (errors, storage), churn metrics | After launch | The V1 console covers selling, billing, lifecycle, and support |

## 10. Launch gates

V1 is not sold until all hold:

- At least 5 stores used Mustawfi daily for 4 weeks as their only system.
- Zero unbalanced journal entries; stock and cash reconciliations match.
- 72-hour offline test on 3 devices selling concurrently, then sync with no loss or duplication.
- A single-tenant restore from backup performed successfully.
- Arabic printing verified on every certified printer.
- Full license lifecycle tested: reminders → grace → read-only → suspended → renewal.
- Isolation test: no path lets one tenant reach another tenant's data.
- The tax-authority approval process has started.
