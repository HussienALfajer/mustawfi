import {
  apiRequest,
  holdDeviceCredential,
  type SecureStore,
  secureStore,
} from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import {
  compactLocalDb,
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
} from "@mustawfi/local-db";
import type { NativeLocalDb } from "@mustawfi/local-db/native";
import { queryOptions } from "@tanstack/react-query";
import { and, eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  currentDeviceSchema,
  type DevicePlatform,
  type DeviceType,
  registeredDeviceSchema,
  registrationCodeResponseSchema,
} from "../shared/index.ts";

/**
 * This client as a registered device (ADR-0022): at most one row. Its credential is in the OS
 * secure store where the platform has one (the Windows app: Credential Manager), and then
 * `credential` is null; elsewhere it stays here — in the browser, which is a limited client
 * (ADR-0010), in the origin's private storage.
 */
const accessDevice = sqliteTable("access_device", {
  id: text().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  prefix: text().notNull(),
  name: text().notNull(),
  type: text().notNull(),
  credential: text(),
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

/**
 * `core-foundation` slice 18: the credential may leave the table for the OS secure store. SQLite
 * cannot drop a `NOT NULL`, so the table is built again with the same rows.
 */
export const deviceCredentialLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.access.0003_device_credential_store",
    statements: [
      `CREATE TABLE access_device_next (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        prefix TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        credential TEXT,
        base_currency TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        one_device INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (one_device = 1)
      ) STRICT`,
      `INSERT INTO access_device_next
        (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
        SELECT id, tenant_id, prefix, name, type, credential, base_currency, registered_at
        FROM access_device`,
      "DROP TABLE access_device",
      "ALTER TABLE access_device_next RENAME TO access_device",
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

/**
 * This device as the server knows it (online): its name — an owner may have renamed it — and the
 * license limit its type counts against, as used of allowed (`core-foundation` slice 20). Out of
 * reach, or before registration, the query fails or answers `null` and «This device» shows what
 * the local database holds.
 */
export function currentDeviceQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: ["access", "devices", "current"] as const,
    queryFn: async ({ signal }) => {
      const credential = await localDeviceCredential(db);
      if (credential === undefined) return null;
      return apiRequest("/api/v1/access/devices/current", {
        schema: currentDeviceSchema,
        bearer: credential,
        signal,
      });
    },
    retry: false,
  });
}

/** The registered device's credential is in neither the local database nor the secure store. */
export class DeviceCredentialMissing extends Error {
  override name = "DeviceCredentialMissing";
}

/** What the secure store holds: the credential with the device it belongs to. */
const keptCredentialSchema = z.object({ deviceId: z.string(), credential: z.string().min(1) });

/**
 * The credential the store keeps for `deviceId`. One kept for another device — left by an earlier
 * registration under this Windows user — is not this device's.
 */
async function keptCredential(store: SecureStore, deviceId: string): Promise<string | undefined> {
  const kept = await store.get("deviceCredential");
  if (kept === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(kept);
  } catch {
    return undefined;
  }
  const result = keptCredentialSchema.safeParse(parsed);
  return result.success && result.data.deviceId === deviceId ? result.data.credential : undefined;
}

/** The registered device's id and the credential column (null once in the store). */
function credentialRow(executor: LocalExecutor) {
  return localOrm(executor)
    .select({ id: accessDevice.id, credential: accessDevice.credential })
    .from(accessDevice)
    .get();
}

/** Writes the credential to the store and reads it back: whether the store now holds it. */
async function keepCredential(
  store: SecureStore,
  deviceId: string,
  credential: string,
): Promise<boolean> {
  await store.set("deviceCredential", JSON.stringify({ deviceId, credential }));
  return (await keptCredential(store, deviceId)) === credential;
}

/**
 * This device's credential, sent as the bearer of every sync request: from the local database,
 * or from the OS secure store once it is kept there. `undefined` while the client is not
 * registered; `DeviceCredentialMissing` when it is and neither holds it.
 */
export async function localDeviceCredential(
  executor: LocalExecutor,
  store: SecureStore | undefined = secureStore(),
): Promise<string | undefined> {
  const row = await credentialRow(executor);
  if (row === undefined) return undefined;
  if (row.credential !== null) return row.credential;
  const kept = store === undefined ? undefined : await keptCredential(store, row.id);
  if (kept === undefined) throw new DeviceCredentialMissing(`no credential for device ${row.id}`);
  return kept;
}

/** The copies of the database file a native shell takes (ADR-0019). */
export type LocalDbCopies = Pick<NativeLocalDb, "backup" | "removeBackups">;

/**
 * Replaces the copies of the file that held the credential: a new copy first (`VACUUM INTO`
 * writes only live rows), and only if it was taken, every copy removed and one taken again, so
 * the device is never left without one.
 */
async function replaceCopies(copies: LocalDbCopies): Promise<void> {
  if ((await copies.backup()) === undefined) {
    throw new Error("no copy of the local database could be taken");
  }
  await copies.removeBackups();
  await copies.backup();
}

/**
 * Moves a credential that an earlier version kept in the local database into the OS secure store
 * (ADR-0022), then deletes it from the database and compacts the file, so neither the file nor
 * its write-ahead log gives it back, and replaces `copies` of the file, which held it too.
 * Resolves to whether it moved one. The store is written and read back first: if that fails, the
 * credential stays in the database, and the next start tries again.
 */
export async function moveDeviceCredentialToSecureStore(
  db: LocalDb,
  store: SecureStore | undefined = secureStore(),
  copies?: LocalDbCopies,
): Promise<boolean> {
  if (store === undefined) return false;
  const row = await credentialRow(db);
  if (row === undefined || row.credential === null) return false;
  const { id, credential } = row;
  if (!(await keepCredential(store, id, credential))) {
    throw new Error("the secure store did not keep the device credential");
  }
  await db.transaction(async (tx) => {
    await localOrm(tx)
      .update(accessDevice)
      .set({ credential: null })
      .where(and(eq(accessDevice.id, id), eq(accessDevice.credential, credential)));
  });
  // The deleted value, and the pages the migration's rebuild freed, leave the file and the log.
  // The copies are replaced even if that fails: a new copy holds only live rows.
  const compaction = await compactLocalDb(db).then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  if (copies !== undefined) await replaceCopies(copies);
  if (compaction !== undefined) throw compaction.error;
  return true;
}

/** Forgets the credential kept in the secure store: a revoked device's wipe (rule 23). */
export async function forgetDeviceCredential(
  store: SecureStore | undefined = secureStore(),
): Promise<void> {
  await store?.delete("deviceCredential");
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
  /** What it runs on, recorded with the type (`core-foundation` slice 20). */
  readonly platform: DevicePlatform;
  readonly storeCode: string;
  readonly registrationCode: string;
  readonly name: string;
}

/**
 * Registers this client with a registration code (flow 4), then keeps the device and its prefix
 * in the local database, and its credential in the OS secure store where the platform has one.
 */
export async function registerThisDevice(
  db: LocalDb,
  input: RegisterThisDeviceInput,
  clock: Clock,
  store: SecureStore | undefined = secureStore(),
): Promise<LocalDevice> {
  if ((await localDevice(db)) !== undefined) throw new DeviceAlreadyRegistered();
  const registered = await apiRequest("/api/v1/access/devices", {
    method: "POST",
    body: input,
    schema: registeredDeviceSchema,
  });
  // The session that registered the device is now bound to it (rule 22): every request made
  // with it from here on carries the credential.
  holdDeviceCredential(registered.credential);
  // Kept at once: the code is used up and the credential is shown only in this answer.
  const device: LocalDevice = {
    deviceId: registered.deviceId,
    tenantId: registered.tenantId,
    prefix: registered.prefix,
    name: registered.name,
    type: input.type,
    baseCurrency: registered.baseCurrency,
    registeredAt: clock.now().toISOString(),
  };
  // Never in the database file where the store takes it. If the store fails, the database keeps
  // it rather than lose the registration, and the next start moves it.
  const inStore =
    store !== undefined &&
    (await keepCredential(store, device.deviceId, registered.credential).catch((error: unknown) => {
      console.error("the secure store did not keep the device credential", error);
      return false;
    }));
  await db.transaction(async (tx) => {
    await localOrm(tx)
      .insert(accessDevice)
      .values({
        id: device.deviceId,
        tenantId: device.tenantId,
        prefix: device.prefix,
        name: device.name,
        type: device.type,
        credential: inStore ? null : registered.credential,
        baseCurrency: device.baseCurrency,
        registeredAt: device.registeredAt,
      });
  });
  return device;
}

/**
 * Tells the server that this revoked device wiped its local data (`core-foundation` rule 23),
 * with the credential it held; the wipe has already removed it from the local database.
 */
export async function reportDeviceWiped(
  credential: string,
  options: { readonly fetch?: typeof fetch } = {},
): Promise<void> {
  await apiRequest("/api/v1/access/devices/current/wipe", {
    method: "POST",
    schema: z.null(),
    bearer: credential,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/**
 * Holds this client's device credential, if it is registered, for the requests made with the
 * session (`core-foundation` rule 22). The composition root calls it once the local database
 * is open, before anything calls the API. A credential that cannot be found leaves the device
 * without one: it keeps selling offline, and sync fails with `DeviceCredentialMissing`.
 */
export async function holdLocalDeviceCredential(executor: LocalExecutor): Promise<void> {
  try {
    holdDeviceCredential(await localDeviceCredential(executor));
  } catch (error) {
    console.error("this device's credential could not be read", error);
    holdDeviceCredential(undefined);
  }
}
