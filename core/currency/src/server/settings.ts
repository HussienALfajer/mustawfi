import { deviceNames, userNames } from "@mustawfi/core-access/server";
import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { recordChange } from "@mustawfi/core-sync/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, type IdGenerator } from "@mustawfi/kernel";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import {
  type BaseCurrencyCode,
  type CurrencyCode,
  currencyCodeSchema,
  currencyProblemCodes,
  CURRENCY_SETTINGS_ENTITY,
  type CurrencySettingsOverview,
  type ExchangeRateView,
  type NamedExchangeRate,
  quotedPair,
  RATE_HISTORY_LIMIT,
  type RatesOverview,
  type saveCurrencySettingsRequestSchema,
  TENANT_CURRENCY_ENTITY,
} from "../shared/index.ts";
import { listTenantCurrencies, readCurrencySettings } from "./currencies.ts";
import {
  currentExchangeRates,
  exchangeRateWire,
  listExchangeRates,
  type RateActor,
  recordExchangeRate,
  tenantBaseCurrency,
} from "./rates.ts";
import { currencySettings, tenantCurrencies } from "./schema.ts";

/** The foreign currencies of `base` that have a current rate against it. */
function ratedCurrencies(
  base: BaseCurrencyCode,
  current: readonly ExchangeRateView[],
): CurrencyCode[] {
  return current.flatMap((rate) => {
    if (rate.unitCurrency === base) return [rate.quoteCurrency];
    if (rate.quoteCurrency === base) return [rate.unitCurrency];
    return [];
  });
}

/** The currency settings screen's data (`GET /api/v1/currency/settings`). */
export async function currencySettingsOverview(
  tx: TenantTransaction,
): Promise<CurrencySettingsOverview> {
  const baseCurrency = await tenantBaseCurrency(tx);
  return {
    baseCurrency,
    currencies: await listTenantCurrencies(tx),
    settings: await readCurrencySettings(tx),
    ratedCurrencies: ratedCurrencies(baseCurrency, await currentExchangeRates(tx)),
  };
}

export type SaveCurrencySettingsInput = z.output<typeof saveCurrencySettingsRequestSchema>;

/**
 * Saves the currency settings (`PUT /api/v1/currency/settings`, `core-money` rules 2–5) in `tx`:
 * the base stays enabled (422 `currency.settings.baseDisabled`); the change currency is enabled
 * (409 `currency.changeCurrency.inUse`); a foreign currency enabled now without a rate comes
 * with its first one (422 `currency.settings.firstRateRequired`), and a first rate is only for
 * an enabled foreign currency without one (422 `currency.settings.firstRateUnexpected`). Each
 * changed currency and the changed settings are audited with before and after and published
 * for devices; each first rate is recorded as any rate is (audited `currency.rate.set`). Steps
 * and the threshold were checked by the request's schema (rules 4–5). The route checks the
 * permission.
 */
export async function saveCurrencySettings(
  tx: TenantTransaction,
  actor: RateActor,
  input: SaveCurrencySettingsInput,
  dependencies: { readonly newId: IdGenerator; readonly at: Date },
): Promise<CurrencySettingsOverview> {
  const { at, newId } = dependencies;
  const base = await tenantBaseCurrency(tx);
  // One save at a time per tenant: the checks below read what the updates then change.
  const [settingsRow] = await tx.select().from(currencySettings).for("update");
  if (settingsRow === undefined) throw new Error("the tenant has no currency settings");
  const rows = await tx.select().from(tenantCurrencies);
  const requested = new Map(input.currencies.map((currency) => [currency.code, currency]));
  const enabledAfter = (code: CurrencyCode) => requested.get(code)?.enabled === true;
  if (!enabledAfter(base)) {
    throw new ProblemError(currencyProblemCodes.baseDisabled, 422, {
      title: "The base currency is always enabled",
      detail: `${base} is the store's base currency`,
    });
  }
  if (!enabledAfter(input.changeCurrency)) {
    throw new ProblemError(currencyProblemCodes.changeCurrencyInUse, 409, {
      title: "The change currency must stay enabled",
      detail: `change is given in ${input.changeCurrency}`,
    });
  }
  const rated = new Set(ratedCurrencies(base, await currentExchangeRates(tx)));
  const firstRates = new Map(input.firstRates.map((first) => [first.currency, first.rate]));
  for (const [currency] of firstRates) {
    if (currency === base || !enabledAfter(currency) || rated.has(currency)) {
      throw new ProblemError(currencyProblemCodes.firstRateUnexpected, 422, {
        title: "A first rate is for an enabled foreign currency without a rate",
        detail: currency,
      });
    }
  }
  for (const row of rows) {
    const code = currencyCodeSchema.parse(row.code);
    const enabling = !row.enabled && enabledAfter(code);
    if (enabling && code !== base && !rated.has(code) && !firstRates.has(code)) {
      throw new ProblemError(currencyProblemCodes.firstRateRequired, 422, {
        title: "Enabling a currency without a rate needs its first rate",
        detail: code,
      });
    }
  }

  const change = { tenantId: actor.tenantId, branchId: actor.branchId, createdAt: at };
  const audited = {
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: at,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
  };
  for (const row of rows) {
    const code = currencyCodeSchema.parse(row.code);
    const next = requested.get(code);
    if (next === undefined) continue;
    const step = Decimal.of(next.cashRoundingStep);
    const stepChanged = !Decimal.of(row.cashRoundingStep).equals(step);
    if (row.enabled === next.enabled && !stepChanged) continue;
    const stepText = step.toString();
    await tx
      .update(tenantCurrencies)
      .set({
        enabled: next.enabled,
        cashRoundingStep: stepText,
        updatedAt: at,
        updatedBy: actor.userId,
      })
      .where(eq(tenantCurrencies.id, row.id));
    const before: Record<string, string | boolean> = { code };
    const after: Record<string, string | boolean> = { code };
    if (row.enabled !== next.enabled) {
      before.enabled = row.enabled;
      after.enabled = next.enabled;
    }
    if (stepChanged) {
      before.cashRoundingStep = Decimal.of(row.cashRoundingStep).toString();
      after.cashRoundingStep = stepText;
    }
    await recordAudit(tx, {
      id: newId(),
      ...audited,
      action:
        row.enabled === next.enabled
          ? "currency.currency.updated"
          : next.enabled
            ? "currency.currency.enabled"
            : "currency.currency.disabled",
      entity: { type: TENANT_CURRENCY_ENTITY, id: row.id },
      before,
      after,
    });
  }
  const settings = {
    changeCurrency: input.changeCurrency,
    rateChangeThresholdPercent: input.rateChangeThresholdPercent,
  };
  const settingsBefore: Record<string, string | number> = {};
  const settingsAfter: Record<string, string | number> = {};
  if (settingsRow.changeCurrency !== settings.changeCurrency) {
    settingsBefore.changeCurrency = settingsRow.changeCurrency;
    settingsAfter.changeCurrency = settings.changeCurrency;
  }
  if (settingsRow.rateChangeThresholdPercent !== settings.rateChangeThresholdPercent) {
    settingsBefore.rateChangeThresholdPercent = settingsRow.rateChangeThresholdPercent;
    settingsAfter.rateChangeThresholdPercent = settings.rateChangeThresholdPercent;
  }
  if (Object.keys(settingsAfter).length > 0) {
    await tx
      .update(currencySettings)
      .set({ ...settings, updatedAt: at, updatedBy: actor.userId })
      .where(eq(currencySettings.id, settingsRow.id));
    await recordAudit(tx, {
      id: newId(),
      ...audited,
      action: "currency.settings.updated",
      entity: { type: CURRENCY_SETTINGS_ENTITY, id: settingsRow.id },
      before: settingsBefore,
      after: settingsAfter,
    });
    await recordChange(
      tx,
      {
        ...change,
        createdBy: actor.userId,
        entity: CURRENCY_SETTINGS_ENTITY,
        entityId: settingsRow.id,
        row: { ...settings },
      },
      { newId },
    );
  }
  // Devices pull every changed currency, with its catalog fields, as seeding published it.
  const views = new Map((await listTenantCurrencies(tx)).map((view) => [view.code, view]));
  for (const row of rows) {
    const code = currencyCodeSchema.parse(row.code);
    const view = views.get(code);
    const next = requested.get(code);
    if (view === undefined || next === undefined) continue;
    if (
      row.enabled === next.enabled &&
      Decimal.of(row.cashRoundingStep).equals(Decimal.of(next.cashRoundingStep))
    ) {
      continue;
    }
    await recordChange(
      tx,
      {
        ...change,
        createdBy: actor.userId,
        entity: TENANT_CURRENCY_ENTITY,
        entityId: row.id,
        row: { ...view },
      },
      { newId },
    );
  }
  for (const [currency, rate] of firstRates) {
    const pair = quotedPair(base, currency);
    await recordExchangeRate(
      tx,
      actor,
      {
        id: newId(),
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        ...pair,
        rate: Decimal.of(rate),
        effectiveAt: at,
        recordedAt: at,
        setBy: actor.userId,
      },
      { confirmed: false },
      { newId },
    );
  }
  return currencySettingsOverview(tx);
}

/** `rates` with the names of who set them and on which device. */
async function named(
  tx: TenantTransaction,
  rates: readonly ExchangeRateView[],
): Promise<NamedExchangeRate[]> {
  const users = await userNames(
    tx,
    rates.map((rate) => rate.setBy),
  );
  const devices = await deviceNames(
    tx,
    rates.flatMap((rate) => (rate.deviceId === null ? [] : [rate.deviceId])),
  );
  return rates.map((rate) => ({
    ...exchangeRateWire(rate),
    setByName: users.get(rate.setBy) ?? null,
    deviceName: rate.deviceId === null ? null : (devices.get(rate.deviceId) ?? null),
  }));
}

/**
 * The rates screen's data for a client that is no registered device (`GET
 * /api/v1/currency/rates`): the base, the currencies and settings, the current rate of each pair,
 * and the latest rates (`RATE_HISTORY_LIMIT`), named.
 */
export async function ratesOverview(tx: TenantTransaction): Promise<RatesOverview> {
  return {
    baseCurrency: await tenantBaseCurrency(tx),
    currencies: await listTenantCurrencies(tx),
    settings: await readCurrencySettings(tx),
    current: await named(tx, await currentExchangeRates(tx)),
    history: await named(tx, await listExchangeRates(tx, RATE_HISTORY_LIMIT)),
  };
}
