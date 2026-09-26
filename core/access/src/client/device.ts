import { apiRequest, holdDeviceCredential } from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  type DeviceType,
  registeredDeviceSchema,
  registrationCodeResponseSchema,
} from "../shared/index.ts";

/**
 * This client as a registered device (ADR-0022): at most one row. The credential stays here —
 * on Windows and Android in the app's own database; in the browser, which is a limited client
 * (ADR-0010), in the origin's private storage.
 */
const accessDevice = sqliteTable("access_device", {
  id: text().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  prefix: text().notNull(),
  name: text().notNull(),
  type: text().notNull(),
  credential: text().notNull(),
  baseCurrency: text("base_currency").notNull(),
  registeredAt: text("registered_at").notNull(),
});

export const ACCESS_DEVICE_TABLE = "access_device";

/** `core.access`'s local schema (ADR-0019). */
export const accessLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.access.0001_device",
    statements: [
      `CREATE TABLE access_device (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        prefix TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        credential TEXT NOT NULL,
        base_currency TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        one_device INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (one_device = 1)
      ) STRICT`,
    ],
  },
];

export interface LocalDevice {
  readonly deviceId: string;
  readonly tenantId: string;
  /** Its document-number prefix (ADR-0020). */
  readonly prefix: string;
  readonly name: string;
  readonly type: DeviceType;
  /** Sent as the bearer of every sync request. */
  readonly credential: string;
  /** What this device sells in until multi-currency sales (`core-money`). */
  readonly baseCurrency: string;
  readonly registeredAt: string;
}

/** This client's registration, or `undefined` while it is not registered. */
export async function localDevice(executor: LocalExecutor): Promise<LocalDevice | undefined> {
  const row = await localOrm(executor).select().from(accessDevice).get();
  if (row === undefined) return undefined;
  return {
    deviceId: row.id,
    tenantId: row.tenantId,
    prefix: row.prefix,
    name: row.name,
    type: row.type as DeviceType,
    credential: row.credential,
    baseCurrency: row.baseCurrency,
    registeredAt: row.registeredAt,
  };
}

export const localDeviceQueryKey = ["local", "access", "device"] as const;

export function localDeviceQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localDeviceQueryKey,
    queryFn: async () => (await localDevice(db)) ?? null,
    networkMode: "always",
    meta: { localTables: [ACCESS_DEVICE_TABLE] },
  });
}

/** Issues a single-use registration code for a new device (owner, online). */
export function issueRegistrationCode() {
  return apiRequest("/api/v1/access/registration-codes", {
    method: "POST",
    schema: registrationCodeResponseSchema,
  });
}

/** This client already has a registration; a reinstall is a new device (ADR-0020). */
export class DeviceAlreadyRegistered extends Error {
  override name = "DeviceAlreadyRegistered";
}

export interface RegisterThisDeviceInput {
  /**
   * What this client is (ADR-0022): the Windows app registers as the store's main POS; the
   * browser, a limited client (ADR-0010, ADR-0019), as a companion.
   */
  readonly type: DeviceType;
  readonly storeCode: string;
  readonly registrationCode: string;
  readonly name: string;
}

/**
 * Registers this client with a registration code (flow 4), then keeps the device, its prefix,
 * and its credential in the local database.
 */
export async function registerThisDevice(
  db: LocalDb,
  input: RegisterThisDeviceInput,
  clock: Clock,
): Promise<LocalDevice> {
  if ((await localDevice(db)) !== undefined) throw new DeviceAlreadyRegistered();
  const registered = await apiRequest("/api/v1/access/devices", {
    method: "POST",
    body: input,
    schema: registeredDeviceSchema,
  });
  // Kept at once: the code is used up and the credential is shown only in this answer.
  const device: LocalDevice = {
    deviceId: registered.deviceId,
    tenantId: registered.tenantId,
    prefix: registered.prefix,
    name: registered.name,
    type: input.type,
    credential: registered.credential,
    baseCurrency: registered.baseCurrency,
    registeredAt: clock.now().toISOString(),
  };
  await db.transaction(async (tx) => {
    await localOrm(tx).insert(accessDevice).values({
      id: device.deviceId,
      tenantId: device.tenantId,
      prefix: device.prefix,
      name: device.name,
      type: device.type,
      credential: device.credential,
      baseCurrency: device.baseCurrency,
      registeredAt: device.registeredAt,
    });
  });
  holdDeviceCredential(device.credential);
  return device;
}

/**
 * Holds this client's device credential, if it is registered, for the requests made with the
 * session (`core-foundation` rule 22). The composition root calls it once the local database
 * is open, before anything calls the API.
 */
export async function holdLocalDeviceCredential(executor: LocalExecutor): Promise<void> {
  holdDeviceCredential((await localDevice(executor))?.credential);
}
