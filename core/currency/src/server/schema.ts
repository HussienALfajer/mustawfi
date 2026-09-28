import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `core_currency` tables (ADR-0016, ADR-0018, ADR-0031). Internal to the module: no entry exports
 * them. The currency catalog itself is code (`CURRENCY_CATALOG` in `../shared`); the checks
 * here mirror it — every catalog currency has two minor units, and each pair is quoted per 1
 * unit of the stronger currency. Rates are append-only: `mustawfi_app` may only insert and
 * read them, and triggers refuse any change or deletion by anyone (`0001_currency_rules.sql`).
 */
export const coreCurrency = pgSchema("core_currency");

/** The catalog codes, as the checks name them. */
const CATALOG_CODES = sql.raw("('SYP', 'USD', 'TRY')");

/**
 * A tenant's currencies: one row per catalog currency, seeded with the tenant by its base
 * (`core-money` rule 2), with the cash-rounding step of each (rule 4). Never deleted.
 */
export const tenantCurrencies = coreCurrency.table(
  "tenant_currencies",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_currency_rules.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** A catalog code; never changes. */
    code: text().notNull(),
    /** Whether new documents and screens offer it; the base is always enabled. */
    enabled: boolean().notNull(),
    /** Cash rounding of a payable in this currency (ADR-0018 named point 3). */
    cashRoundingStep: numeric({ precision: 20, scale: 4 }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    updatedBy: uuid().notNull(),
  },
  (t) => [
    unique("tenant_currencies_code_per_tenant").on(t.tenantId, t.code),
    check("tenant_currencies_code", sql`${t.code} in ${CATALOG_CODES}`),
    // A positive multiple of the minor unit (two for every catalog currency), at most 1000.
    check(
      "tenant_currencies_cash_rounding_step",
      sql`${t.cashRoundingStep} > 0 and ${t.cashRoundingStep} <= 1000
        and ${t.cashRoundingStep} = round(${t.cashRoundingStep}, 2)`,
    ),
  ],
);

/** The tenant's currency settings, one row, seeded with it (`core-money` rules 3 and 5). */
export const currencySettings = coreCurrency.table(
  "currency_settings",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** The currency change is given in; one of the tenant's currencies. */
    changeCurrency: text().notNull(),
    /** A new rate moving more than this percent from the current one asks for confirmation. */
    rateChangeThresholdPercent: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    updatedBy: uuid().notNull(),
  },
  (t) => [
    unique("currency_settings_one_per_tenant").on(t.tenantId),
    check("currency_settings_threshold", sql`${t.rateChangeThresholdPercent} between 1 and 100`),
    foreignKey({
      name: "currency_settings_change_currency_fk",
      columns: [t.tenantId, t.changeCurrency],
      foreignColumns: [tenantCurrencies.tenantId, tenantCurrencies.code],
    }),
  ],
);

/**
 * Exchange rates, append-only (ADR-0031, `core-money` rules 6–8): units of `quote_currency` per
 * 1 unit of `unit_currency`, the stronger of the two. The current rate of a pair is the one with
 * the latest `effective_at`, ties broken by id. `created_at` is when the server recorded it and
 * `created_by` who set it; `device_id` and `op_id` name the device and sync operation of a rate
 * set offline, and are both null for one set online.
 */
export const exchangeRates = coreCurrency.table(
  "exchange_rates",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    unitCurrency: text().notNull(),
    quoteCurrency: text().notNull(),
    rate: numeric({ precision: 20, scale: 6 }).notNull(),
    /** Server time when set online; the device's guarded time when set offline (rule 9). */
    effectiveAt: timestamp({ withTimezone: true }).notNull(),
    deviceId: uuid(),
    opId: uuid(),
  },
  (t) => [
    index("exchange_rates_current").on(
      t.tenantId,
      t.unitCurrency,
      t.quoteCurrency,
      t.effectiveAt,
      t.id,
    ),
    // The quote direction of ADR-0031, from the catalog's strength order: USD, TRY, SYP.
    check(
      "exchange_rates_quote_direction",
      sql`(${t.unitCurrency}, ${t.quoteCurrency}) in (('USD', 'SYP'), ('TRY', 'SYP'), ('USD', 'TRY'))`,
    ),
    // At most 12 whole digits, so it fits a device's 64-bit integer at ×10⁶ (ADR-0018 amendment).
    check("exchange_rates_rate_fits_devices", sql`${t.rate} > 0 and ${t.rate} < 1000000000000`),
    check("exchange_rates_device_op", sql`(${t.deviceId} is null) = (${t.opId} is null)`),
    foreignKey({
      name: "exchange_rates_unit_currency_fk",
      columns: [t.tenantId, t.unitCurrency],
      foreignColumns: [tenantCurrencies.tenantId, tenantCurrencies.code],
    }),
    foreignKey({
      name: "exchange_rates_quote_currency_fk",
      columns: [t.tenantId, t.quoteCurrency],
      foreignColumns: [tenantCurrencies.tenantId, tenantCurrencies.code],
    }),
  ],
);
