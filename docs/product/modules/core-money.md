# Core money (`core-money`)

- Status: Spec ready
- Modules covered: `core.currency`, `core.ledger`
- Spec agreed with the user on: 2026-09-28

## Purpose

Give the store real money handling and real books. The owner sets the dollar (and lira) rate whenever the market moves, even with the internet down, and every device uses it at once or at its next sync. The accountant gets a chart of accounts they recognize, journal entries in any of the store's currencies that always balance in the base currency, exchange differences computed without asking, manual and opening entries, a period lock, an account ledger, and a trial balance. Treasury, customers, sales, and purchases build on these interfaces: they post with a currency, a rate, a department, and a subject, and never compute exchange differences or balances themselves.

## Scope (V1)

**`core.currency` — currencies and rates**
- A currency catalog: the new Syrian pound (SYP), the US dollar (USD), and the Turkish lira (TRY), each with its minor units (2) and its place in the strength order that fixes how a rate is quoted (ADR-0031).
- Per tenant: the enabled currencies (the base always; one foreign currency enabled by default; TRY off by default), the cash-rounding step per currency, the change currency, and the rate-change confirmation threshold.
- Exchange rates: one current rate per enabled foreign currency against the base, set whenever the owner wants, append-only with history, settable online or on a device while offline (a sync operation), delivered to every device through pull.
- Conversion helpers for every module: base ↔ foreign at a named rounding point, and foreign ↔ foreign rounded once (ADR-0031).
- A warning when the rate in use was set before the current business day; a confirmation when a new rate differs from the last by more than the threshold.
- Screens: exchange rates (every form factor), currency settings.
- The hard-coded minor units in `sales` (`MINOR_UNITS`) and the price-currency list in `inventory/client` move to the catalog.

**`core.ledger` — accounting engine**
- Chart of accounts as a tree of group and posting accounts with hierarchical codes, seeded from a retail template that assigns the system keys V1 needs; editable (create, rename, re-code, move, archive, restore).
- Multi-currency journal lines (transaction currency, amount, rate, base amount) and a subject dimension (`customer`, `supplier`, `cashBox`, … registered by modules) on top of the department dimension.
- Weighted-average carrying of foreign balances and automatic realized exchange differences (ADR-0031).
- Reversal of an entry, exact to the last digit.
- The period lock: a lock date with history, the devices-behind check, late device documents moved to the first open day and flagged, owner-only reopening.
- Manual journal entries and opening-balance entries for the accountant, online, numbered per device (`JRN`).
- Journal list and entry detail, account ledger, trial balance, with department scope.

## Out of scope

| Item | Where |
|---|---|
| Items priced in a foreign currency sold in the cart, the rate a cart uses when the rate changes mid-cart, payment in several currencies with change, applying the cash-rounding step to a payable (ADR-0018 named point 3) | `sales` (this unit provides the rates, the steps, the change currency, and the helpers) |
| Cash boxes as `cashBox` subjects, currency exchange inside a box, owner drawings, shift variance | `treasury` |
| Customers' and suppliers' account currency, statements, credit limits (`customer` and `supplier` subjects) | `customers`, `purchases` |
| Revaluation of unrealized exchange differences | After V1, with larger customers (ADR-0031) |
| Sector templates for the phones and supermarket packs (repairs revenue, carrier balances, …) | Their units add accounts and system keys by migration |
| Excel import of opening balances with the old-pound ÷100 option | `core-services` (`core.data`); this unit provides the posting |
| Exporting the account ledger and trial balance to Excel and PDF, profit and loss, balance sheet | `reports` |
| Notifications («rate not set today», «period can be locked») | `core-services` (`core.notifications`); this unit shows banners |
| Typed settings through `core.config` | `core-config`; this unit's settings are its own data (see *Settings*) and may be exposed there later |
| Fixed assets, depreciation, bank reconciliation, budgets, cost centers beyond departments | Out of V1 (`v1-scope.md` §9) |
| Year-end closing entries | Not needed: reports carry prior years' profit into retained earnings (rule 36) |

## Dependencies

- `core-foundation` (done): `core.tenancy` (tenant, base currency, departments), `core.access` (permissions, templates, scopes, devices, supervisor rules), `core.organization` (document codes and the number format; the server's document sequences), `core.audit` (audit entries), `core.config` (module registry, manifests), `core.sync` (operations, flags, change log, pull).
- The walking skeleton's `core.ledger` (seeded accounts, `postJournalEntry`, database immutability and balance triggers) and `sales` posting (`postInvoiceV1`).
- Module dependencies after this unit (the manifest check holds them): `core.currency` → `core.config`, `core.tenancy`, `core.audit`, `core.sync`. `core.ledger` → `core.config`, `core.tenancy`, `core.currency`, `core.audit`, `core.sync`, `core.organization`. `v1-scope.md` §3 is updated.
- ADR-0006, ADR-0007, ADR-0016, ADR-0018 (with its 2026-09-27 amendment on device ranges), ADR-0020, and **ADR-0031 (accepted in this session)**.
- Consumed later by: `treasury`, `customers`, `sales`, `purchases`, `reports`, `recharge`, `repairs`.

## Entities and data

**`core.currency`** (schema `core_currency`)

| Entity | Key fields | Notes |
|---|---|---|
| `currencies` (catalog, not tenant-owned) | `code` (`SYP`, `USD`, `TRY`), `minorUnits` (2), `strengthRank` (USD 1, TRY 2, SYP 3) | Seeded by migration; read-only for the app role. A new currency is a migration and a release. Arabic names and symbols are i18n keys (`ل.س`, `$`, `ل.ت`). |
| `tenantCurrencies` | `tenantId`, `branchId`, `code`, `enabled`, `cashRoundingStep` | One row per catalog currency per tenant, seeded at tenant creation. Defaults: SYP step 10, USD 0.01, TRY 1. Base SYP → SYP and USD enabled; base USD → USD and SYP enabled; TRY disabled. Pulled by devices with the catalog fields joined. |
| `currencySettings` | `tenantId`, `branchId`, `changeCurrency` (default SYP), `rateChangeThresholdPercent` (default 10) | One row per tenant; pulled by devices. |
| `exchangeRates` | `id` (UUIDv7), `tenantId`, `branchId`, `unitCurrency`, `quoteCurrency`, `rate` (`numeric(20,6)`, at most 12 whole digits), `effectiveAt`, `recordedAt`, `setBy`, `deviceId` (null when set online), `opId` (null when set online) | Append-only (database refuses update and delete). The pair is base and foreign in the quote direction of ADR-0031: SYP per USD, SYP per TRY (base SYP), TRY per USD (base USD). Pulled by devices. |

**`core.ledger`** (schema `core_ledger`)

| Entity | Key fields | Notes |
|---|---|---|
| `accounts` | `id`, `code`, `name`, `kind` (asset, liability, equity, revenue, expense), `parentId`, `isGroup`, `systemKey`, `currencyTracked`, `subjectType` (null, or the subject type the account requires), `archivedAt` | Tree. `kind` is the top-level group's. Server-only (accounting screens are online). |
| `journalEntries` | existing columns + `number` (manual entries), `kind` (`document`, `manual`, `opening`, `reversal`), `reversesEntryId`, `reversedByEntryId` (set through the reversal's insert, see rule 25), `postedAfterLock` | `accountingDate` on the entry; the source document keeps its `businessDate` (ADR-0016). |
| `journalLines` | existing columns + `transactionCurrency`, `transactionAmount`, rate (`rateUnitCurrency`, `rateQuoteCurrency`, `rate`), `subjectType`, `subjectId`, `lineRole` (`regular`, `rounding`, `fxDifference`) | `debit`/`credit` are base amounts. For a base-currency line the transaction amount equals the base amount and there is no rate. Exact column names are the implementer's (slice 5). |
| `carriedBalances` | `accountId`, `subjectType`, `subjectId`, `currency`, `currencyBalance`, `baseBalance` | One row per currency-tracked account, subject (or none), and foreign currency. Exactly the sums of the lines on that key (rule 20). Updated under a row lock in the posting transaction. |
| `lockDates` | `id`, `lockedThrough` (date), `setBy`, `setAt`, `reason` (required when it moves back) | Append-only history; the latest row is the lock date. |
| `ledgerSettings` | `fiscalYearStartMonth` (1–12, default 1) | One row per tenant. |
| `subjectTypes` (registry in code, not a table) | `type`, owning module, lookup (name, archived) | Registered by modules through the ledger's server interface. None is registered in this unit. |

**Retail chart-of-accounts template** (codes and Arabic names; ◆ = group account; system keys in brackets; *T* = currency-tracked; *S:x* = requires subject `x` once its module registers it). The advisor accountant reviews it before the first pilot (*Open questions*).

| Code | Name | Notes |
|---|---|---|
| 1 ◆ | الأصول | asset |
| 11 ◆ | الأصول المتداولة | |
| 1101 | الصناديق | [`cash`] *T*, *S:cashBox* (from `treasury`) |
| 1102 | المحافظ الإلكترونية والبطاقات | *T* |
| 1103 | البنوك | *T* |
| 1110 | ذمم الزبائن | [`receivables`] *T*, *S:customer* |
| 1120 | المخزون | [`inventory`] |
| 1130 | سلف الموظفين | [`staffAdvances`] *T* |
| 1140 | أرصدة مدينة أخرى | *T* |
| 12 ◆ | الأصول الثابتة | |
| 1201 | الأثاث والتجهيزات | |
| 1202 | الأجهزة والحواسيب | |
| 2 ◆ | الخصوم | liability |
| 21 ◆ | الخصوم المتداولة | |
| 2101 | ذمم الموردين | [`payables`] *T*, *S:supplier* |
| 2102 | دفعات مقدمة من الزبائن | [`customerDeposits`] *T*, *S:customer* |
| 2103 | أرصدة دائنة أخرى | *T* |
| 3 ◆ | حقوق الملكية | equity |
| 31 ◆ | رأس المال والحسابات الجارية | |
| 3101 | رأس المال | |
| 3102 | جاري المالك | [`ownerDrawings`] |
| 3103 | الأرباح المحتجزة | [`retainedEarnings`] |
| 3104 | الأرصدة الافتتاحية | [`openingBalances`] |
| 4 ◆ | الإيرادات | revenue |
| 41 ◆ | إيرادات النشاط | |
| 4101 | إيرادات المبيعات | [`salesRevenue`] |
| 4102 | مردودات المبيعات | [`salesReturns`] |
| 4103 | الخصم المسموح به | [`salesDiscounts`] |
| 4104 | إيرادات الخدمات | |
| 42 ◆ | إيرادات أخرى | |
| 4201 | إيرادات متنوعة | |
| 5 ◆ | المصروفات | expense |
| 51 ◆ | تكلفة المبيعات | |
| 5101 | تكلفة البضاعة المباعة | [`costOfGoodsSold`] |
| 5102 | فروقات الجرد | [`stockAdjustments`] |
| 52 ◆ | المصاريف التشغيلية | |
| 5201 | الإيجار | |
| 5202 | الكهرباء والأمبيرات | |
| 5203 | الرواتب والأجور | |
| 5204 | الاتصالات والإنترنت | |
| 5205 | النقل | |
| 5206 | الصيانة | |
| 5209 | مصاريف متنوعة | |
| 59 ◆ | الفروقات | |
| 5901 | فروق التقريب | [`roundingDifferences`] |
| 5902 | فروق الصرف | [`fxDifference`] |
| 5903 | عجز وزيادة الصناديق | [`cashVariance`] |

The skeleton's accounts (1100, 4100, 5900) become 1101, 4101, 5901 under their groups; their ids and lines are kept.

## Business rules and invariants

Rules marked **[I]** are invariants that tests must protect.

**Currencies**
1. **[I]** Only catalog currencies exist. A tenant's base currency is SYP or USD, set at creation, never changed (ADR-0007); TRY is a transaction currency only.
2. The base currency is always enabled. A foreign currency is enabled or disabled by users with `currency.settings.manage`. Enabling a currency with no rate asks for its first rate in the same step. Disabling one hides it from new documents and screens; its balances and history stay; device documents in it that arrive later are accepted.
3. **[I]** The change currency is an enabled currency; disabling the change currency is refused (409 `currency.changeCurrency.inUse`).
4. **[I]** A cash-rounding step is a positive multiple of its currency's minor unit and at most 1000 (400 otherwise). Defaults: SYP 10, USD 0.01 (no rounding), TRY 1.
5. The rate-change threshold is a whole percent from 1 to 100, default 10.

**Rates**
6. **[I]** A rate is for a pair of the base currency and an enabled foreign currency, quoted in the ADR-0031 direction (units of the weaker per 1 unit of the stronger by `strengthRank`). An inverted pair, a pair without the base, or two foreign currencies is refused (422 `currency.rate.invalidPair`); the kernel's `ExchangeRate` refuses to build an inverted pair for a catalog currency.
7. **[I]** A rate is positive and has at most 12 whole digits and 6 decimals (ADR-0018 amendment), checked by the request schema, the operation payload schema, and a database `CHECK`.
8. **[I]** Rates are append-only; the current rate of a pair is the one with the latest `effectiveAt`, ties by id. A rate arriving with an older `effectiveAt` than the current one is stored as history and changes nothing current.
9. A rate set online takes the server's time as `effectiveAt`. A rate set on a device takes the device's guarded time (clock guard, ADR-0021) and applies on that device at once, before sync.
10. **[I]** Setting a rate needs `currency.rate.set` (routes: 403; the sync operation: accepted and flagged `permissionMissing`, as for every operation — core-foundation rule 17). Every rate is audited (`currency.rate.set`, before and after, device when set offline).
11. When the new rate differs from the current one by more than the threshold (in either direction), the screen asks for confirmation, showing the old rate, the new rate, the change in percent, and an example (100 units of the foreign currency in the base, or the reverse). The route requires `confirmed: true` in that case (422 `currency.rate.confirmationRequired`); the device operation carries the confirmation the device obtained and is never refused for it.
12. A device shows a **stale-rate** banner on the POS and home screens while any enabled foreign currency's current rate was set before the start of the current business day (Asia/Damascus); users with `currency.rate.set` see a «set the rate» action in it. Selling is never blocked by a stale rate (non-negotiable 4). A foreign currency with no rate at all cannot be used in a new document until one is set; the screen says so.
13. **[I]** Conversions round only at ADR-0018's named points, half away from zero. A foreign ↔ foreign conversion multiplies and divides exactly by the two rates against the base and rounds once to the target's minor unit (ADR-0031). Property-tested: within half a minor unit of the exact value.

**Chart of accounts**
14. **[I]** Every tenant has the template's tree, and every system key of the template exactly once, from its creation (in the same transaction, as today). Top-level groups 1–5 cannot be moved, re-coded, or archived; they can be renamed.
15. **[I]** An account's code is digits only, unique in the tenant, and starts with its parent's code. Its kind is its top-level group's. Only posting accounts take lines; a posting account with lines cannot become a group, and a group with children cannot become a posting account.
16. An account can be renamed, re-coded, or moved under another group of the same top-level group (not under itself or a descendant) by users with `ledger.accounts.manage`. `currencyTracked` and `subjectType` can change only while the account has no lines. Every change is audited with before and after.
17. **[I]** A system account is never archived. Another posting account is archived only when its balance is zero in every currency (409 `ledger.account.hasBalance`); a group only when all its children are archived. An archived account takes no new manual lines, keeps its history, appears in reports for periods where it moved, and can be restored.

**Posting**
18. **[I]** Every entry balances in the base currency, exactly (ADR-0006); the database trigger remains. Each line has one positive side. Zero lines are refused.
19. **[I]** A line in a foreign currency carries its transaction amount, its rate, and its base amount (named point 2 conversion). The residual left by conversions is one explicit rounding line to `roundingDifferences`, at most half a base minor unit per converted line; a larger residual refuses the posting (`ledger.entry.unbalanced`).
20. **[I]** For every currency-tracked account, subject, and foreign currency, `carriedBalances` holds exactly the sums of the lines on that key (currency and base). A balance whose currency amount is zero has a base value of zero.
21. **[I]** A line on a currency-tracked account in a foreign currency that reduces its carried balance is relieved at the balance's average rate (ADR-0031): relief = base value × amount ÷ currency balance, rounded half away from zero; clearing the balance relieves the whole base value; crossing zero relieves up to zero and opens the remainder at the document's rate. The difference from the document-rate base amount is a line to `fxDifference` with the relieved line's department, in the same entry. Worked example (base SYP): a customer owes 100 USD carried at 11,000 SYP (rate 110); a payment of 100 USD at 120 (12,000 SYP) relieves 11,000 and posts a 1,000 SYP exchange gain.
22. **[I]** A line's subject type must be registered; an account with a `subjectType` requires a subject of that type on every line, and an account without one takes no subject (422 `ledger.entry.invalid`). The ledger never reads a subject's table; it asks the owning module's lookup.
23. **[I]** A line names a posting account (not a group; not archived for a manual entry), an active department of the tenant, and an enabled currency — except device documents, which are accepted with the currency and department they carry (ADR-0020).
24. Only `core.ledger`'s interface writes ledger tables (`postJournalEntry`, `reverseJournalEntry`, manual and opening entries). Posting runs on the server only.

**Reversal**
25. **[I]** A reversal negates every line of the original, the rounding and exchange-difference lines included, with the same transaction and base amounts, and updates carried balances by the same negated amounts; it computes no exchange difference. An entry is reversed at most once; a reversal is never reversed (409 `ledger.entry.alreadyReversed`, `ledger.entry.isReversal`). Property-tested: original plus reversal is zero on every account, subject, currency, and department.
26. A reversal's accounting date is chosen by its caller and must be open. The manual screen defaults to the original's accounting date when open, otherwise the first open day.

**Period lock**
27. **[I]** No journal entry may be written with an accounting date on or before the lock date; the database refuses it.
28. **[I]** The lock date moves forward only to a date before today (business date, Asia/Damascus), and only when every active device (not revoked) has reported pushing everything up to the end of the new lock date; otherwise 409 `ledger.lock.devicesBehind` with the list of devices and their pushed-through times. A device reports its pushed-through time — its guarded time at a moment its outbox was empty — on each sync round (`core.sync`).
29. **[I]** Moving the lock date back needs `ledger.period.reopen` (owners by default, granted to no template) and a reason; it is audited (`ledger.period.reopened`). Moving it forward is audited (`ledger.period.locked`). The history is kept.
30. **[I]** A device document whose business date is on or before the lock date is accepted, keeps its business date, and posts with the accounting date of the first open day; its entry is marked `postedAfterLock` and the operation is flagged `postedAfterLock` (a new operation flag code). An online entry (manual, opening, reversal) with a locked date is refused (422 `ledger.period.locked`).

**Manual and opening entries**
31. Manual and opening entries are created online only, from a registered device (core-foundation rule 22), with `ledger.entries.post`. The server allocates their number `{prefix}-JRN-{seq:6}` from the device's sequence for `JRN`. They record the user, the device, and per line the department and currency; they have no shift and no print template (not printed in V1).
32. **[I]** A manual entry has at least two lines, a memo, an accounting date that is open and not after today, and balances in the base after conversion (rule 19). Each department on its lines is in the user's scope.
33. An opening entry is a manual entry whose difference is balanced automatically by a line to `openingBalances`. Several opening entries are allowed (later units post theirs, for example stock and customer debts).
34. Reversing a manual or opening entry needs `ledger.entries.reverse`; the reversal gets its own `JRN` number and links both ways.

**Reports**
35. The account ledger of an account (optionally one subject, one department, one currency) for a date range shows the opening balance, each line with its accounting date, entry number or source document, memo, debit, credit, and running balance in the base; for a currency-tracked account filtered to one currency, also the transaction amounts and the running balance in that currency.
36. **[I]** The trial balance for a date range lists every account with lines, opening balance, debits, credits, closing balance, summed up the tree to the chosen level. Revenue and expense accounts open at the start of the fiscal year containing the range's start; the profit of earlier fiscal years is added to `retainedEarnings`'s opening balance. Without a department filter, total debits equal total credits at every column.
37. A user with a department scope sees only lines of their departments in every ledger screen; a department-filtered trial balance need not balance and says so.

Events this unit audits: rate set (online and device), currency enabled or disabled, cash-rounding step, change currency, and threshold changed, account created, edited (before/after), archived, restored, manual entry posted, opening entry posted, entry reversed, lock date moved forward, lock date moved back (with reason), fiscal-year start changed.

## Accounting impact

- This unit is the posting engine; its own documents post as follows:
  - **Manual entry:** the lines the accountant entered, plus a rounding line when conversions leave a residual (rule 19) and exchange-difference lines when a foreign carried balance is relieved (rule 21).
  - **Opening entry:** the lines entered, balanced to `openingBalances` (3104).
  - **Reversal:** the exact negation of the original (rule 25).
- Exchange differences go to `fxDifference` (5902), rounding residuals to `roundingDifferences` (5901), both with the department of the line that caused them.
- Department dimension: every line carries a department; the tenant's default department when only one exists (core-foundation rule 29 hides the choice).
- Currency: entries balance in the base; lines keep their transaction currency, amount, and rate.
- `sales` keeps posting cash / sales revenue in the base (the skeleton path), now through the lock rules (rule 30).

## Flows

Screens are Arabic, RTL, with numbers, codes, and amounts as LTR islands (ADR-0024). Accounting screens are desktop and tablet; the rates screen also fits a phone.

1. **Set the rate (every form factor, online or offline).** Home or POS banner «سعر الدولار من أمس» → «تحديد السعر» (holders of `currency.rate.set`) → the rates screen shows each enabled foreign currency: current rate with the quote direction («ل.س لكل 1 $»), when and by whom it was set → enter the new rate → if the change exceeds the threshold, a confirmation shows old, new, change in percent, and «100 $ = 12,200 ل.س» → save. Online: the route; offline: the operation, applied locally at once, synced later. History below: the last rates with time, user, device.
2. **Currency settings (desktop, online, `currency.settings.manage`).** Enabled currencies with a switch each (enabling asks for the first rate), the cash-rounding step per currency, the change currency, the threshold. Saving audits each change.
3. **Chart of accounts (desktop and tablet, online).** A tree with codes, names, and balances in the base; search by code or name; expand to a level. Add account (group or posting, parent, code proposed as the next free code under the parent, name, currency-tracked); edit; archive (refused with the reason when it has a balance or is a system account); restore. System accounts carry a mark and cannot be archived.
4. **Manual entry (desktop, online).** Date (default today), memo, lines: account (by code or name, posting accounts only), department (hidden with one department), currency (default base), debit or credit, rate (prefilled with the current rate for a foreign currency, editable), base amount computed live. Footer: total debits, total credits, difference in the base; «ترحيل» enabled when the difference is zero after rounding. After posting: the entry detail with its `JRN` number.
5. **Opening balances (desktop, online).** The same form in opening mode: the date defaults to the day before the store's first document; the difference goes to «الأرصدة الافتتاحية» and is shown as a line before posting.
6. **Journal (desktop and tablet, online).** List by date range with number or source document, kind, memo, total, department filter. Entry detail: lines with account, subject, department, currency amount, rate, debit and credit in the base, the source document, the reversal link; «عكس القيد» for manual and opening entries (date per rule 26, confirmation).
7. **Account ledger (desktop and tablet, online).** Pick an account (and optionally a subject, a department, a currency), a date range; opening, lines, running balance, closing (rule 35).
8. **Trial balance (desktop and tablet, online).** Date range, level (1–4 or all), department filter; columns opening, debit, credit, closing; totals; a note when a department filter is on (rule 37).
9. **Period lock (desktop, online).** Current lock date and history. «قفل حتى» a date → refused with the list of devices behind (name, last pushed-through time, a link to revoke for holders of `access.devices.manage`), or confirmed. Owners see «إعادة فتح» with a date and a required reason.
10. **Fiscal year start (desktop, online, `ledger.accounts.manage`).** A month, default January, in the ledger settings next to the lock.

### Screens after this unit

- «أسعار الصرف» — every signed-in user with `currency.rate.set` edits; everyone with `ledger.view` or on the POS reads the current rate.
- «العملات» — settings, owners by default.
- «المحاسبة» section: «دليل الحسابات», «القيود», «قيد يدوي», «أرصدة افتتاحية», «كشف حساب», «ميزان المراجعة», «قفل الفترة».
- The stale-rate banner on the POS and home.

## Permissions

Template grants: **A** accountant, **S** section cashier, **R** repair technician, **T** top-up operator; the owner holds all.

| Permission | Scoped | Meaning | Default grants |
|---|---|---|---|
| `currency.rate.set` | no | Set an exchange rate (route and sync operation) | A |
| `currency.settings.manage` | no | Enable currencies, steps, change currency, threshold | — |
| `ledger.view` | yes | Chart, journal, entry detail, account ledger, trial balance, lock date | A |
| `ledger.accounts.manage` | no | Create, edit, archive, restore accounts; fiscal-year start | A |
| `ledger.entries.post` | yes | Post manual and opening entries | A |
| `ledger.entries.reverse` | yes | Reverse manual and opening entries | A |
| `ledger.period.lock` | no | Move the lock date forward | A |
| `ledger.period.reopen` | no | Move the lock date back, with a reason | — |

Limits: none. Every route and the `currency.rate.set` operation name their permission (core-foundation rule 17).

## Offline and sync behavior

- **Works offline:** setting a rate (operation `currency.rate.set`, payload version 1: `rateId`, `unitCurrency`, `quoteCurrency`, `rate`, `effectiveAt`, `confirmed`), reading current rates and currency settings, conversions, the stale-rate banner.
- **Append-only, pushed:** rates set on devices; documents (their posting moves past a lock, rule 30).
- **Server-authoritative, pulled:** `tenantCurrencies` (with catalog fields), `currencySettings`, `exchangeRates` — full rows through the change log; a new device receives them with its first pull. Their local tables are appended at the end of `LOCAL_MIGRATIONS`. Every value fits the device's 64-bit scaled integers (rule 7; ADR-0018 amendment); new pulled fields are optional or defaulted.
- **Reported by devices:** the pushed-through time on each sync round (rule 28).
- **Flagged after sync:** `permissionMissing` on a rate operation; `postedAfterLock` on a document posted past the lock date.
- **Online only:** currency settings; every ledger screen and route (chart, entries, reversal, opening, reports, lock).
- **Sync-simulation cases:** two devices offline set different rates and converge to the latest `effectiveAt`; a device returns after the lock with documents dated in the locked period — every sale is accepted, posted on the first open day, flagged, and the ledger still balances.

## Settings and customization points

- This unit's settings are its own data, not `core.config` typed settings (which arrive with `core-config`): per tenant the enabled currencies, cash-rounding steps (SYP 10, USD 0.01, TRY 1), change currency (SYP), rate-change threshold (10%), and in the ledger the fiscal-year start month (January).
- Fixed defaults: the stale-rate boundary is the business day (Asia/Damascus); the cash-rounding step limit 1000.
- The chart of accounts is customization layer 4–5 territory for tenant admins (tree edits); the ledger rules themselves are never customizable (overview §8).
- No entitlements, custom fields, or templates in this unit.

## Edge cases

| Case | Behavior |
|---|---|
| The owner types 12200 (old pounds) instead of 122 | The change exceeds 10%: confirmation shows +9,900% and «100 $ = 1,220,000 ل.س». If confirmed anyway, the rate applies and the owner corrects it with a new rate (confirmed again); documents made meanwhile keep the wrong rate and are corrected by returns. |
| Two devices set the rate offline, at 9:00 (125) and 9:05 (124) | Each uses its own until sync; afterwards 124 is current everywhere; documents keep the rate they used. |
| A device offline since morning sets 126 at 10:00; the owner set 127 online at 11:00 | 126 arrives as history; 127 stays current. |
| USD is enabled but no rate was ever set (a new tenant) | Items and documents in USD cannot be used; the banner asks for the first rate. |
| The owner disables TRY while cash in TRY exists | Allowed; the balances stay and show in reports; no new TRY documents; a TRY document from an offline device is accepted. |
| Disabling the change currency | Refused (rule 3). |
| A customer owing 100 USD pays 150 USD | Relieves 100 at the average (exchange difference as needed) and opens a 50 USD credit at the payment's rate. |
| A payment is reversed after later payments moved the average | The reversal mirrors the original exactly; the average blends; no exchange difference on the reversal. |
| A USD-base store spends SYP from a box whose SYP lost value | Each relief of the SYP balance posts the realized loss at the average; correct, and visible in 5902. |
| The accountant locks through the 30th while a companion phone has been offline since the 25th | Refused with the phone listed; wait for it to sync or revoke it. |
| A revoked device returns with sales dated inside the locked period | Accepted, flagged `deviceRevoked` and `postedAfterLock`, posted on the first open day; the locked period does not change. |
| The owner reopens a month to fix an entry, then locks again | Allowed with a reason; both moves audited; the forward move checks devices again. |
| A manual entry is being written when the lock moves past its date | Posting is refused (422 `ledger.period.locked`); the form keeps its lines so the date can be changed. |
| A lock date of today or later | Refused (400). |
| Archiving an account with a balance, or a system account | Refused with the reason (rule 17). |
| Re-coding a system account | Allowed; the system key identifies it. |
| A trial balance filtered to one department does not balance | Shown with a note (rule 37). |
| A caller's lines leave a conversion residual beyond the bound (a defect) | The engine refuses the posting. A device document is still never refused (ADR-0020): its handler posts from the document's own totals, which a correct handler builds within the bound, and flags `arithmeticMismatch` when the device's arithmetic disagrees. |
| A foreign-currency line on an account that is not currency-tracked (revenue in USD) | Converted at its rate; no carried balance, no exchange difference. |

## Acceptance criteria

1. The currency catalog holds SYP, USD, TRY with two minor units; a new tenant has its currencies, steps, change currency, and threshold seeded by its base; `sales` and `inventory` read minor units from it.
2. A rate set online or offline becomes current on every device after sync by the latest `effectiveAt`; a rate over the threshold needs confirmation; every rate is audited; a rate without permission is flagged.
3. The stale-rate banner appears when a foreign rate predates the business day and never blocks a sale.
4. A new tenant has the retail chart with every system key; accounts can be created, edited, archived, and restored under rules 14–17; the skeleton's sales posting still works on the re-coded accounts.
5. Journal entries accept lines in SYP, USD, and TRY with rates and subjects, balance in the base, and add a bounded rounding line.
6. Foreign carried balances equal the sums of their lines; relieving them posts the realized exchange difference at the weighted average; the worked example of rule 21 posts exactly 1,000 SYP.
7. A reversal mirrors its original to the last digit, once.
8. The lock date refuses entries on or before it at the database; advancing it lists devices behind; late device documents post on the first open day and are flagged; owners reopen with a reason.
9. The accountant posts manual and opening entries online with `JRN` numbers, and reverses them.
10. The account ledger and trial balance match hand-computed fixtures; the unfiltered trial balance always balances; department scope is applied.
11. `pnpm verify` passes, and the Playwright journey of slice 11 runs in CI.

## Verification plan

- **Unit and property-based (fast-check):** conversions and cross conversions (rule 13); quote direction; every posted entry balances (random multi-currency sequences, extending `apps/server/src/ledger.test.ts`); residual bound; carried balances equal the sums of lines and clear to zero (rules 20–21); reversal mirrors (rule 25); allocation unchanged.
- **Integration (Testcontainers PostgreSQL):** RLS isolation of every new table; append-only and immutability triggers; lock-date trigger; tree rules; route permissions and problem codes; seeding at tenant creation; audit entries.
- **Sync simulation:** the two cases under *Offline and sync behavior*.
- **End to end (Playwright):** set a rate offline and see it on a second device after sync; post a manual entry in USD and one relieving it at another rate, see the exchange difference in the trial balance; lock a period and reopen it.
- **Manual:** the advisor accountant reviews the chart template and a sample trial balance (*Open questions*).

## Slices

| # | Slice | Done when (3–5 checks) | Effort | Depends on | Status |
|---|---|---|---|---|---|
| 1 | Currency catalog, tenant currencies, rates domain | `core/currency` package exists and passes `check:boundaries`; catalog (SYP, USD, TRY), `tenantCurrencies`, `currencySettings` seeded at tenant creation by base (existing tenants by migration), RLS isolation tested · `exchangeRates` append-only at the database; current rate by latest `effectiveAt` then id, tested · kernel cross conversion rounds once and the quote direction refuses an inverted pair (property tests) · `MINOR_UNITS` in `sales` and the price-currency list in `inventory/client` read the catalog; `pnpm verify` passes | high | — | Not started |
| 2 | Setting rates online and offline | `POST /api/v1/currency/rates` with `currency.rate.set`, bounds 400, pair 422, confirmation 422, audited · sync operation `currency.rate.set` accepted, idempotent, flagged `permissionMissing` without the permission · rates and currency rows pulled through the change log; local tables appended at the end of `LOCAL_MIGRATIONS`; the device's current rate updates at once when set locally and after pull · sync-simulation: two offline devices converge on the latest `effectiveAt` | high | 1 | Not started |
| 3 | Currency screens and the stale-rate banner | Rates screen (current, set, confirmation over the threshold with an example, history) works offline and on a phone width · currency settings screen (enable with a first rate, steps, change currency, threshold) for `currency.settings.manage`, rules 2–5 enforced by the route · stale-rate banner on POS and home per rule 12 · all text through i18n keys; component tests | medium | 2 | Not started |
| 4 | Chart of accounts tree | Migration to the tree; retail template seeded at tenant creation; skeleton accounts re-coded to 1101/4101/5901 with their lines kept · template test: every system key once, codes prefix-consistent, kinds by top group · routes to list, create, edit, archive, restore under rules 14–17 with `ledger.view` / `ledger.accounts.manage`, audited · the skeleton's sales posting and ledger tests pass | high | — | Not started |
| 5 | Multi-currency lines and subjects | Lines store transaction currency, amount, rate, base amount, subject, role · subject-type registry in the ledger's server interface; rules 22–23 enforced · `postJournalEntry` converts foreign lines and adds the bounded rounding line (rule 19); property test: random multi-currency entries always balance · `.claude/rules/ledger.md` updated for rates on lines and subjects | high | 1, 4 | Not started |
| 6 | Carried balances, exchange differences, reversal | `carriedBalances` maintained in posting under a row lock; relief at the average, crossing zero, exchange-difference line (rule 21); the worked example is a named test · property tests: carried balance = sums of lines; zero currency ⇒ zero base; entries balance · `reverseJournalEntry` mirrors exactly, once, never a reversal (property test) · immutability database tests still pass | xhigh | 5 | Not started |
| 7 | Period lock | Lock-date history and a database trigger refusing entries on or before it · devices report their pushed-through time; advancing the lock is refused with the devices behind; revoked devices ignored · device documents in a locked period post on the first open day, keep their business date, flagged `postedAfterLock` (new flag code); online entries refused 422 · reopening with `ledger.period.reopen` and a reason, audited · sync-simulation case: a late device after the lock | high | 4 | Not started |
| 8 | Manual and opening entries, journal routes | Manual entry route (online, registered device, `JRN` number from the device's sequence), rules 31–32 with problem codes · opening entry balanced to `openingBalances` · reversal route (rules 25–26, 34) · journal list and entry detail routes with department scope; every action audited | high | 6, 7 | Not started |
| 9 | Accounting screens: chart, journal, manual entry, lock | Chart tree screen (add, edit, archive, restore) · journal list and entry detail with reverse · manual and opening entry form with live base totals and difference · lock screen with devices behind and owner reopen, fiscal-year start · component tests; i18n keys | medium | 8 | Not started |
| 10 | Account ledger and trial balance | Account ledger query and route per rule 35 · trial balance per rule 36 (fiscal-year start, retained earnings from prior years, tree levels) · department scope and filter (rule 37) · both match a hand-computed multi-currency fixture; the unfiltered trial balance balances (property test over random postings) | medium | 6 | Not started |
| 11 | Report screens and the unit's acceptance journey | Account ledger and trial balance screens (filters, levels, LTR amounts, department note) · Playwright journey: rate set offline reaches a second device; a USD manual entry and its relief at another rate show the exchange difference in the trial balance; lock and reopen · acceptance criteria 1–11 walked and recorded in the slice notes | medium | 3, 9, 10 | Not started |

### Slice notes and deviations

None yet.

## Open questions

- **Advisor accountant review** of the chart template, the SYP cash-rounding step (10), the TRY step (1), and the placement of rounding and exchange differences under expenses (59). Default until reviewed: as written. ADR-0018's deferred SYP step is settled at 10 by the user on 2026-09-28, pending that review.
- **`sales` invoice rate semantics.** `sales.invoices.exchange_rate` is documented as «of `currency` to the base currency», which inverts the ADR-0031 quote direction for a USD-base tenant selling in SYP. Default: `sales` stores the pair explicitly when it lifts `unsupportedCurrency`; recorded as inherited by the `sales` unit.
- **Rate used by a cart when the rate changes before completion.** Default: the rate current at completion, shown on the receipt. Decided in the `sales` spec.

## Changelog

- 2026-09-28 — Spec agreed. The user added the Turkish lira as a transaction currency (a recorded change to `v1-scope.md`) and chose: one rate changed at will, settable offline; SYP cash rounding to 10; change currency as a tenant setting; subjects on control accounts; lock date with owner reopening; weighted-average realized differences; no revaluation in V1; online-only accounting screens; stale rate warns, never blocks; 10% confirmation threshold; `currency.rate.set` for owner and accountant; USD without cash rounding, TRY to 1. ADR-0031 accepted by the user.
