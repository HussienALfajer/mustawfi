import type { APIRequestContext } from "@playwright/test";
import type { LicenseTermsInput } from "@mustawfi/tools-license";
import { issueTestLicense, testLicensePublicKeys } from "@mustawfi/tools-license/testing";
import { expect } from "./test.ts";
import { e2eStore } from "./environment.ts";
import { runCli } from "./server-cli.ts";

/**
 * Stores of their own for journeys that change what a store is — its license, its users — made
 * as Vertex staff make them, with the `tenant:create` and `license:install` CLIs.
 */

export const OWNER = { login: "owner", password: "correct horse battery staple", name: "هالة" };
export const CASHIER = { login: "cashier", password: "cashier horse battery staple", name: "ليلى" };

export interface JourneyStore {
  readonly storeCode: string;
  readonly tenantId: string;
}

export type Terms = Pick<
  LicenseTermsInput,
  "notBefore" | "expiresAt" | "graceDays" | "readOnlyDays"
>;

let stores = 0;

/** A new store licensed with `terms`, its owner `OWNER`. */
export async function createStore(terms: Terms): Promise<JourneyStore> {
  stores += 1;
  const license = await issueTestLicense({ ...terms, limits: { companionDevices: 5, users: 10 } });
  const created = await runCli(
    "src/cli/create-tenant.ts",
    [
      ...["--name", `متجر الرحلة ${String(stores)}`, "--base-currency", "SYP"],
      ...["--owner-name", OWNER.name, "--owner-login", OWNER.login, "--license", license.jws],
    ],
    { DATABASE_URL: e2eStore().databaseUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
    `${OWNER.password}\n`,
  );
  const { storeCode } = JSON.parse(created) as { storeCode: string };
  return { storeCode, tenantId: license.claims.tenant };
}

/** Installs a newer license for the store, as Vertex staff do with the `license:install` CLI. */
export async function installLicense(store: JourneyStore, terms: Terms): Promise<void> {
  const license = await issueTestLicense({ ...terms, tenant: store.tenantId });
  await runCli(
    "src/cli/install-license.ts",
    ["--store", store.storeCode, "--license", license.jws],
    { DATABASE_URL: e2eStore().databaseUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
  );
}

/** Adds `CASHIER`, a section cashier over every department, through the API as the owner. */
export async function addCashier(request: APIRequestContext, store: JourneyStore): Promise<void> {
  const signedIn = await request.post("/api/v1/access/login", {
    data: { storeCode: store.storeCode, login: OWNER.login, password: OWNER.password },
  });
  expect(signedIn.status()).toBe(200);
  const { token } = (await signedIn.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const roles = (await (await request.get("/api/v1/access/roles", { headers })).json()) as {
    items: { id: string; template: string | null }[];
  };
  const created = await request.post("/api/v1/access/users", {
    headers,
    data: {
      name: CASHIER.name,
      login: CASHIER.login,
      password: CASHIER.password,
      roleId: roles.items.find((role) => role.template === "sectionCashier")?.id,
      departmentScope: "all",
      pin: "4826",
    },
  });
  expect(created.status()).toBe(201);
}
