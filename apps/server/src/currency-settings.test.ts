import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { hostProblemCodes, problemDetailsSchema } from "@mustawfi/core-config/shared";
import {
  CURRENCY_SETTINGS_ENTITY,
  currencyProblemCodes,
  currencySettingsOverviewSchema,
  currencySettingsSchema,
  type CurrencySettingsOverview,
  ratesOverviewSchema,
  TENANT_CURRENCY_ENTITY,
  tenantCurrencySchema,
} from "@mustawfi/core-currency/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHostServer } from "./host-server.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createServerRegistry } from "./modules.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * The currency settings (`core-money` slice 3, rules 2–5) and the rates screen's data for a
 * client that is no registered device.
 */

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-28T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
}

beforeAll(async () => {
  database = await createTestDatabase("currency_settings");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

async function newStore(name: string, baseCurrency: "SYP" | "USD" = "SYP"): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency, ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
  );
  return { tenant, token: await signInAs(server, tenant, "ahmad", PASSWORD) };
}

function request(
  token: string | null,
  method: "GET" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  return server.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
  });
}

async function overview(store: Store): Promise<CurrencySettingsOverview> {
  const response = await request(store.token, "GET", "/api/v1/currency/settings");
  expect(response.statusCode, response.body).toBe(200);
  return currencySettingsOverviewSchema.parse(response.json());
}

/** The body that saves `current` as it is, with `change` applied. */
function saved(
  current: CurrencySettingsOverview,
  change: {
    readonly currencies?: Record<string, { enabled?: boolean; cashRoundingStep?: string }>;
    readonly changeCurrency?: string;
    readonly rateChangeThresholdPercent?: number;
    readonly firstRates?: readonly { currency: string; rate: string }[];
  } = {},
): Record<string, unknown> {
  return {
    currencies: current.currencies.map((currency) => ({
      code: currency.code,
      enabled: currency.enabled,
      cashRoundingStep: currency.cashRoundingStep,
      ...change.currencies?.[currency.code],
    })),
    changeCurrency: change.changeCurrency ?? current.settings.changeCurrency,
    rateChangeThresholdPercent:
      change.rateChangeThresholdPercent ?? current.settings.rateChangeThresholdPercent,
    ...(change.firstRates === undefined ? {} : { firstRates: change.firstRates }),
  };
}

async function save(store: Store, body: Record<string, unknown>) {
  return request(store.token, "PUT", "/api/v1/currency/settings", body);
}

async function saveOk(store: Store, body: Record<string, unknown>) {
  clock.advance(1_000);
  const response = await save(store, body);
  expect(response.statusCode, response.body).toBe(200);
  return currencySettingsOverviewSchema.parse(response.json());
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

async function auditsOf(store: Store, action: string) {
  const { rows } = await superuser.query<{ before: unknown; after: unknown; created_by: string }>(
    `select before, after, created_by from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [store.tenant.tenantId, action],
  );
  return rows;
}

async function changesOf(store: Store, entity: string) {
  const { rows } = await superuser.query<{ row: unknown }>(
    "select row from core_sync.changes where tenant_id = $1 and entity = $2 order by seq",
    [store.tenant.tenantId, entity],
  );
  return rows.map((row) => row.row);
}

describe("GET /api/v1/currency/settings", () => {
  it("shows the base, the seeded currencies and settings, and no rated currency yet", async () => {
    const store = await newStore("متجر الأمل");
    expect(await overview(store)).toEqual({
      baseCurrency: "SYP",
      currencies: [
        { code: "SYP", minorUnits: 2, strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
        { code: "USD", minorUnits: 2, strengthRank: 1, enabled: true, cashRoundingStep: "0.01" },
        { code: "TRY", minorUnits: 2, strengthRank: 2, enabled: false, cashRoundingStep: "1.00" },
      ],
      settings: { changeCurrency: "SYP", rateChangeThresholdPercent: 10 },
      ratedCurrencies: [],
    });
  });

  it("needs currency.settings.manage, which no template grants: 401, 403", async () => {
    const store = await newStore("متجر الصلاحيات");
    const accountant = await createStaffUser(
      tenants,
      store.tenant,
      { login: "accountant", permissions: ["currency.rate.set"] },
      dependencies,
    );
    const token = await signInAs(server, store.tenant, accountant.login);
    const current = await overview(store);
    expectProblem(
      await request(null, "GET", "/api/v1/currency/settings"),
      401,
      accessProblemCodes.sessionRequired,
    );
    expectProblem(
      await request(token, "GET", "/api/v1/currency/settings"),
      403,
      accessProblemCodes.permissionDenied,
    );
    expectProblem(
      await request(token, "PUT", "/api/v1/currency/settings", saved(current)),
      403,
      accessProblemCodes.permissionDenied,
    );
    const manager = await createStaffUser(
      tenants,
      store.tenant,
      { login: "manager", permissions: ["currency.settings.manage"] },
      dependencies,
    );
    const managerToken = await signInAs(server, store.tenant, manager.login);
    const response = await request(
      managerToken,
      "PUT",
      "/api/v1/currency/settings",
      saved(current, { rateChangeThresholdPercent: 15 }),
    );
    expect(response.statusCode, response.body).toBe(200);
  });
});

describe("PUT /api/v1/currency/settings (rules 2–5)", () => {
  it("saves steps, the change currency, and the threshold: audited and pulled by devices", async () => {
    const store = await newStore("متجر الشام");
    const before = await overview(store);
    const after = await saveOk(
      store,
      saved(before, {
        currencies: { SYP: { cashRoundingStep: "50" }, USD: { cashRoundingStep: "0.25" } },
        changeCurrency: "USD",
        rateChangeThresholdPercent: 25,
      }),
    );
    expect(after.currencies.map((c) => [c.code, c.cashRoundingStep])).toEqual([
      ["SYP", "50.00"],
      ["USD", "0.25"],
      ["TRY", "1.00"],
    ]);
    expect(after.settings).toEqual({ changeCurrency: "USD", rateChangeThresholdPercent: 25 });
    expect(await auditsOf(store, "currency.currency.updated")).toEqual([
      {
        created_by: store.tenant.ownerId,
        before: { code: "SYP", cashRoundingStep: "10" },
        after: { code: "SYP", cashRoundingStep: "50" },
      },
      {
        created_by: store.tenant.ownerId,
        before: { code: "USD", cashRoundingStep: "0.01" },
        after: { code: "USD", cashRoundingStep: "0.25" },
      },
    ]);
    expect(await auditsOf(store, "currency.settings.updated")).toEqual([
      {
        created_by: store.tenant.ownerId,
        before: { changeCurrency: "SYP", rateChangeThresholdPercent: 10 },
        after: { changeCurrency: "USD", rateChangeThresholdPercent: 25 },
      },
    ]);
    // Seeding published every currency once; the save, the two it changed.
    const currencies = (await changesOf(store, TENANT_CURRENCY_ENTITY)).map((row) =>
      tenantCurrencySchema.parse(row),
    );
    expect(currencies.slice(3).map((c) => [c.code, c.cashRoundingStep])).toEqual([
      ["SYP", "50.00"],
      ["USD", "0.25"],
    ]);
    const settings = (await changesOf(store, CURRENCY_SETTINGS_ENTITY)).map((row) =>
      currencySettingsSchema.parse(row),
    );
    expect(settings.at(-1)).toEqual({ changeCurrency: "USD", rateChangeThresholdPercent: 25 });
  });

  it("changes nothing and audits nothing when nothing changed", async () => {
    const store = await newStore("متجر الثبات");
    const before = await overview(store);
    expect(await saveOk(store, saved(before))).toEqual(before);
    expect(await auditsOf(store, "currency.currency.updated")).toEqual([]);
    expect(await auditsOf(store, "currency.settings.updated")).toEqual([]);
    expect(await changesOf(store, TENANT_CURRENCY_ENTITY)).toHaveLength(3);
  });

  it("asks for the first rate of a currency enabled without one, and records it (rule 2)", async () => {
    const store = await newStore("متجر الحدود");
    const before = await overview(store);
    expectProblem(
      await save(store, saved(before, { currencies: { TRY: { enabled: true } } })),
      422,
      currencyProblemCodes.firstRateRequired,
    );
    const after = await saveOk(
      store,
      saved(before, {
        currencies: { TRY: { enabled: true } },
        firstRates: [{ currency: "TRY", rate: "4.25" }],
      }),
    );
    expect(after.currencies.find((c) => c.code === "TRY")?.enabled).toBe(true);
    expect(after.ratedCurrencies).toEqual(["TRY"]);
    const { rows } = await superuser.query(
      `select unit_currency, quote_currency, rate::text as rate from core_currency.exchange_rates
       where tenant_id = $1`,
      [store.tenant.tenantId],
    );
    // SYP per 1 TRY: the stronger currency is the unit (ADR-0031).
    expect(rows).toEqual([{ unit_currency: "TRY", quote_currency: "SYP", rate: "4.250000" }]);
    expect(await auditsOf(store, "currency.currency.enabled")).toEqual([
      {
        created_by: store.tenant.ownerId,
        before: { code: "TRY", enabled: false },
        after: { code: "TRY", enabled: true },
      },
    ]);
    expect(await auditsOf(store, "currency.rate.set")).toHaveLength(1);
    // Disabled again, and enabled again: it has a rate now, so none is asked for.
    const disabled = await saveOk(store, saved(after, { currencies: { TRY: { enabled: false } } }));
    expect(await auditsOf(store, "currency.currency.disabled")).toHaveLength(1);
    await saveOk(store, saved(disabled, { currencies: { TRY: { enabled: true } } }));
  });

  it("quotes a USD-base store's first lira rate as TRY per 1 USD", async () => {
    const store = await newStore("متجر الدولار", "USD");
    const before = await overview(store);
    await saveOk(
      store,
      saved(before, {
        currencies: { TRY: { enabled: true } },
        firstRates: [{ currency: "TRY", rate: "41.5" }],
      }),
    );
    const { rows } = await superuser.query(
      "select unit_currency, quote_currency from core_currency.exchange_rates where tenant_id = $1",
      [store.tenant.tenantId],
    );
    expect(rows).toEqual([{ unit_currency: "USD", quote_currency: "TRY" }]);
  });

  it("offers a first rate for an enabled currency that has none yet (a new store's dollar)", async () => {
    const store = await newStore("متجر البداية");
    const after = await saveOk(
      store,
      saved(await overview(store), { firstRates: [{ currency: "USD", rate: "122" }] }),
    );
    expect(after.ratedCurrencies).toEqual(["USD"]);
  });

  it("refuses a first rate for the base, a disabled currency, or one already rated", async () => {
    const store = await newStore("متجر الأسعار");
    const before = await overview(store);
    for (const firstRates of [[{ currency: "SYP", rate: "1" }], [{ currency: "TRY", rate: "4" }]]) {
      expectProblem(
        await save(store, saved(before, { firstRates })),
        422,
        currencyProblemCodes.firstRateUnexpected,
      );
    }
    const rated = await saveOk(
      store,
      saved(before, { firstRates: [{ currency: "USD", rate: "122" }] }),
    );
    expectProblem(
      await save(store, saved(rated, { firstRates: [{ currency: "USD", rate: "123" }] })),
      422,
      currencyProblemCodes.firstRateUnexpected,
    );
  });

  it("keeps the base enabled (422) and the change currency enabled (409, rule 3)", async () => {
    const store = await newStore("متجر القواعد");
    const before = await overview(store);
    expectProblem(
      await save(store, saved(before, { currencies: { SYP: { enabled: false } } })),
      422,
      currencyProblemCodes.baseDisabled,
    );
    expectProblem(
      await save(
        store,
        saved(before, { changeCurrency: "USD", currencies: { USD: { enabled: false } } }),
      ),
      409,
      currencyProblemCodes.changeCurrencyInUse,
    );
    expectProblem(
      await save(store, saved(before, { changeCurrency: "TRY" })),
      409,
      currencyProblemCodes.changeCurrencyInUse,
    );
    // Any other foreign currency can be disabled; its history stays.
    const after = await saveOk(store, saved(before, { currencies: { USD: { enabled: false } } }));
    expect(after.currencies.find((c) => c.code === "USD")?.enabled).toBe(false);
    expect(await overview(store)).toEqual(after);
  });

  it.each([
    ["a step of zero", { currencies: { SYP: { cashRoundingStep: "0" } } }],
    ["a step finer than the minor unit", { currencies: { USD: { cashRoundingStep: "0.001" } } }],
    ["a step above 1000", { currencies: { SYP: { cashRoundingStep: "1000.01" } } }],
    ["a threshold of 0", { rateChangeThresholdPercent: 0 }],
    ["a threshold above 100", { rateChangeThresholdPercent: 101 }],
    ["a fractional threshold", { rateChangeThresholdPercent: 10.5 }],
    ["a malformed first rate", { firstRates: [{ currency: "USD", rate: "0" }] }],
  ])("refuses %s (400, rules 4–5)", async (_, change) => {
    const store = await newStore(`متجر الحدود ${String(newId())}`);
    const response = await save(store, saved(await overview(store), change));
    expectProblem(response, 400, hostProblemCodes.invalidRequest);
  });

  it("refuses a currency missing, repeated, or outside the catalog (400)", async () => {
    const store = await newStore("متجر القائمة");
    const current = await overview(store);
    const body = saved(current) as { currencies: { code: string }[] };
    for (const currencies of [
      body.currencies.slice(0, 2),
      [body.currencies[0], body.currencies[0], body.currencies[1]],
      [...body.currencies.slice(0, 2), { ...body.currencies[2], code: "EUR" }],
    ]) {
      expectProblem(
        await save(store, { ...body, currencies }),
        400,
        hostProblemCodes.invalidRequest,
      );
    }
    expect(await overview(store)).toEqual(current);
  });
});

describe("GET /api/v1/currency/rates", () => {
  it("lists the current rates and the latest ones with who set them, for currency.rate.set", async () => {
    const store = await newStore("متجر الصرافة");
    const set = (rate: string) =>
      server.inject({
        method: "POST",
        url: "/api/v1/currency/rates",
        payload: { unitCurrency: "USD", quoteCurrency: "SYP", rate },
        headers: { authorization: `Bearer ${store.token}` },
      });
    expect((await set("122")).statusCode).toBe(201);
    clock.advance(60_000);
    expect((await set("123")).statusCode).toBe(201);
    const response = await request(store.token, "GET", "/api/v1/currency/rates");
    expect(response.statusCode, response.body).toBe(200);
    const rates = ratesOverviewSchema.parse(response.json());
    expect(rates.baseCurrency).toBe("SYP");
    expect(rates.settings.rateChangeThresholdPercent).toBe(10);
    expect(rates.current.map((r) => [r.rate, r.setByName, r.deviceName])).toEqual([
      ["123", "أحمد", null],
    ]);
    expect(rates.history.map((r) => r.rate)).toEqual(["123", "122"]);
    const viewer = await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer", permissions: ["inventory.products.view"] },
      dependencies,
    );
    expectProblem(
      await request(
        await signInAs(server, store.tenant, viewer.login),
        "GET",
        "/api/v1/currency/rates",
      ),
      403,
      accessProblemCodes.permissionDenied,
    );
  });
});
