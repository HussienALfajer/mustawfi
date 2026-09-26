import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import {
  currentLicense,
  currentTenant,
  requireWritableLicense,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { randomIndex, UNAMBIGUOUS_ALPHABET } from "@mustawfi/kernel";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import {
  accessProblemCodes,
  deviceNameSchema,
  deviceTypeSchema,
  type DeviceType,
  type DeviceView,
} from "../shared/index.ts";
import { auditAs, type RoleActor } from "./actor.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { devices, registrationCodes, sessions, users } from "./schema.ts";
import { bearerToken } from "./sessions.ts";
import { issueBearer, issueOneTimeCode, readBearer, oneTimeCodeHash } from "./secrets.ts";

/** A registration code works for fifteen minutes (ADR-0022: short-lived). */
export const REGISTRATION_CODE_LIFETIME_MS = 15 * 60 * 1000;

/** Every two-symbol prefix, in alphabet order: 32 × 32 = 1024 per tenant (ADR-0020). */
export const DEVICE_PREFIXES: readonly string[] = [...UNAMBIGUOUS_ALPHABET].flatMap((first) =>
  [...UNAMBIGUOUS_ALPHABET].map((second) => first + second),
);

export interface IssuedRegistrationCode {
  readonly id: string;
  /** Shown to the owner once, as `ABCDE-FGHJK`; only its hash is stored. */
  readonly code: string;
  readonly expiresAt: Date;
}

/** Issues a single-use registration code in `tx`, a `withTenant` transaction; audited. */
export async function issueRegistrationCode(
  tx: TenantTransaction,
  issuer: { readonly tenantId: string; readonly branchId: string; readonly userId: string },
  dependencies: AccessDependencies,
): Promise<IssuedRegistrationCode> {
  const now = dependencies.clock.now();
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_LIFETIME_MS);
  const { token: code, hash } = issueOneTimeCode(dependencies.random);
  const id = dependencies.newId();
  await tx.insert(registrationCodes).values({
    id,
    tenantId: issuer.tenantId,
    branchId: issuer.branchId,
    createdAt: now,
    createdBy: issuer.userId,
    codeHash: hash,
    expiresAt,
  });
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: issuer.tenantId,
    branchId: issuer.branchId,
    occurredAt: now,
    userId: issuer.userId,
    action: "access.registrationCode.issued",
    entity: { type: "access.registrationCode", id },
    after: { expiresAt: expiresAt.toISOString() },
  });
  return { id, code, expiresAt };
}

export interface NewDevice {
  readonly tenantId: string;
  /** As typed on the device. */
  readonly registrationCode: string;
  readonly type: DeviceType;
  readonly name: string;
}

export interface RegisteredDevice {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly prefix: string;
  /** The device credential, handed to the device once; only its hash is stored. */
  readonly credential: string;
  /** The store's base currency: what the device sells in until `core-money`. */
  readonly baseCurrency: string;
}

export function registrationFailed(): ProblemError {
  return new ProblemError(accessProblemCodes.registrationFailed, 401, {
    title: "The store code or registration code is wrong, used, or expired",
  });
}

/**
 * Registers a device with a registration code in `tx`, a `withTenant` transaction for the
 * code's tenant (ADR-0022). The code is used up in the same transaction, so two devices
 * racing with one code get one registration. A device beyond the license's limit for its
 * type is refused (409 `tenancy.limit.mainPosDevices` or `tenancy.limit.companionDevices`,
 * `core-foundation` rule 4) after the code is checked, so only a holder of a valid code learns
 * the limit. The device gets a prefix no device of the tenant has ever had, chosen at random
 * among the free ones, and a fresh credential. A refusal throws and rolls everything back,
 * the code's use included. While the license is read-only or suspended, registration is a
 * refused write (403 `tenancy.license.readOnly`, rule 5), again only after the code is checked.
 */
export async function registerDevice(
  tx: TenantTransaction,
  device: NewDevice,
  dependencies: AccessDependencies,
): Promise<RegisteredDevice> {
  const type = deviceTypeSchema.parse(device.type);
  const name = deviceNameSchema.parse(device.name);
  const codeHash = oneTimeCodeHash(device.registrationCode);
  if (codeHash === undefined) throw registrationFailed();

  const now = dependencies.clock.now();
  const [code] = await tx
    .update(registrationCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(registrationCodes.codeHash, codeHash),
        isNull(registrationCodes.usedAt),
        gt(registrationCodes.expiresAt, now),
      ),
    )
    .returning({
      id: registrationCodes.id,
      branchId: registrationCodes.branchId,
      issuedBy: registrationCodes.createdBy,
    });
  if (code === undefined) throw registrationFailed();

  // One registration at a time per tenant, so two cannot pick the same free prefix or both
  // take the last place the license allows.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`core_access.devices:${device.tenantId}`}, 0))`,
  );
  // A public route: the guard cannot see the tenant, so registration checks the license itself.
  await requireWritableLicense(tx, now);
  await checkDeviceLimit(tx, type);
  const taken = new Set(
    (await tx.select({ prefix: devices.prefix }).from(devices)).map((row) => row.prefix),
  );
  const free = DEVICE_PREFIXES.filter((prefix) => !taken.has(prefix));
  const prefix = free[free.length === 0 ? 0 : randomIndex(dependencies.random, free.length)];
  if (prefix === undefined) {
    throw new ProblemError(accessProblemCodes.prefixesExhausted, 409, {
      title: "Every device prefix of this store is taken",
    });
  }

  const deviceId = dependencies.newId();
  const { token: credential, hash: credentialHash } = issueBearer(
    "device",
    device.tenantId,
    dependencies.random,
  );
  await tx.insert(devices).values({
    id: deviceId,
    tenantId: device.tenantId,
    branchId: code.branchId,
    createdAt: now,
    createdBy: code.issuedBy,
    name,
    type,
    prefix,
    credentialHash,
    registrationCodeId: code.id,
  });
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: device.tenantId,
    branchId: code.branchId,
    occurredAt: now,
    userId: code.issuedBy,
    deviceId,
    action: "access.device.registered",
    entity: { type: "access.device", id: deviceId },
    after: { name, type, prefix, registrationCodeId: code.id },
  });
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("a device registered outside its tenant");
  return {
    deviceId,
    tenantId: device.tenantId,
    name,
    prefix,
    credential,
    baseCurrency: tenant.baseCurrency,
  };
}

/** How many devices of `type` count against the license's limit: those not revoked (rule 4). */
export async function activeDeviceCount(tx: TenantTransaction, type: DeviceType): Promise<number> {
  const [row] = await tx
    .select({ devices: count() })
    .from(devices)
    .where(and(eq(devices.type, type), isNull(devices.revokedAt)));
  return row?.devices ?? 0;
}

/**
 * Refuses one more device of `type` beyond the license's limit (rule 4); run under the
 * registration lock. A lower limit after a downgrade removes no device; revoked devices do not
 * count.
 */
async function checkDeviceLimit(tx: TenantTransaction, type: DeviceType): Promise<void> {
  const license = await currentLicense(tx);
  if (license === undefined) throw new Error("the tenant has no license");
  const { limits } = license.claims;
  const [allowed, code] =
    type === "mainPos"
      ? [limits.mainPosDevices, tenancyProblemCodes.mainPosDeviceLimit]
      : [limits.companionDevices, tenancyProblemCodes.companionDeviceLimit];
  if ((await activeDeviceCount(tx, type)) >= allowed) {
    throw new ProblemError(code, 409, {
      title: "The license's device limit is reached",
      detail: `the license allows ${String(allowed)} ${type} devices`,
    });
  }
}

/** An authenticated device. */
export interface Device {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly prefix: string;
  readonly type: DeviceType;
  readonly name: string;
  /** Set once the device is revoked: its credential then opens push alone (rule 23). */
  readonly revokedAt: Date | null;
}

/**
 * The device a credential belongs to, revoked or not, or `undefined` for a malformed or
 * unknown one. Callers refuse a revoked device where rule 23 says so.
 */
export async function authenticateDevice(
  tenants: TenantDatabase,
  credential: string,
): Promise<Device | undefined> {
  const bearer = readBearer("device", credential);
  if (bearer === undefined) return undefined;
  const [row] = await tenants.withTenant({ tenantId: bearer.tenantId }, (tx) =>
    tx
      .select({
        deviceId: devices.id,
        tenantId: devices.tenantId,
        branchId: devices.branchId,
        prefix: devices.prefix,
        type: devices.type,
        name: devices.name,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.credentialHash, bearer.hash)),
  );
  return row === undefined ? undefined : { ...row, type: deviceTypeSchema.parse(row.type) };
}

/**
 * The device of a request's `Authorization: Bearer` device credential, or a 401
 * `access.device.required` — the same refusal whatever was wrong with it. A revoked device is a
 * 401 `access.device.revoked` unless `allowRevoked` (push and the wipe report, rule 23). The
 * route guard calls this for `device` routes (sync): a device syncs as itself, and each
 * operation names the user who performed it (ADR-0022).
 */
export async function requireDevice(
  request: { readonly headers: { readonly authorization?: string | undefined } },
  context: { readonly tenants: TenantDatabase },
  options: { readonly allowRevoked?: boolean } = {},
): Promise<Device> {
  const credential = bearerToken(request.headers.authorization);
  const device =
    credential === undefined ? undefined : await authenticateDevice(context.tenants, credential);
  if (device === undefined) throw deviceRequired();
  if (device.revokedAt !== null && options.allowRevoked !== true) throw deviceRevoked();
  return device;
}

/** 401 `access.device.required`. */
export function deviceRequired(): ProblemError {
  return new ProblemError(accessProblemCodes.deviceRequired, 401, {
    title: "This device is not registered",
  });
}

/** 401 `access.device.revoked`: the credential is a revoked device's (rule 23). */
export function deviceRevoked(): ProblemError {
  return new ProblemError(accessProblemCodes.deviceRevoked, 401, {
    title: "This device was removed from the store",
  });
}

function deviceNotFound(): ProblemError {
  return new ProblemError(accessProblemCodes.deviceNotFound, 404, {
    title: "No such device in this store",
  });
}

interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly prefix: string;
  readonly createdAt: Date;
  readonly lastSyncAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
  readonly wipedAt: Date | null;
  readonly revokedById: string | null;
  readonly revokedByName: string | null;
}

function deviceView(row: DeviceRow): DeviceView {
  return {
    id: row.id,
    name: row.name,
    type: deviceTypeSchema.parse(row.type),
    prefix: row.prefix,
    registeredAt: row.createdAt.toISOString(),
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    status: row.revokedAt === null ? "active" : "revoked",
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy:
      row.revokedById === null ? null : { id: row.revokedById, name: row.revokedByName ?? "" },
    revokeReason: row.revokeReason,
    wipedAt: row.wipedAt?.toISOString() ?? null,
  };
}

/** Devices with the name of whoever revoked them. */
function selectDevices(tx: TenantTransaction) {
  return tx
    .select({
      id: devices.id,
      name: devices.name,
      type: devices.type,
      prefix: devices.prefix,
      createdAt: devices.createdAt,
      lastSyncAt: devices.lastSyncAt,
      revokedAt: devices.revokedAt,
      revokeReason: devices.revokeReason,
      wipedAt: devices.wipedAt,
      revokedById: users.id,
      revokedByName: users.name,
    })
    .from(devices)
    .leftJoin(users, eq(users.id, devices.revokedBy));
}

/** Every device of the tenant in `tx`, revoked ones included, in registration order. */
export async function listDevices(tx: TenantTransaction): Promise<DeviceView[]> {
  const rows = await selectDevices(tx).orderBy(asc(devices.createdAt), asc(devices.id));
  return rows.map(deviceView);
}

/**
 * Revokes a device in `tx` (flow 9, rule 23), by `actor` (who holds
 * `access.devices.manage`), with a reason: its sessions end now, its credential opens push
 * alone from the next request, and it stops counting against the license's device limit. Its
 * prefix stays taken. Audited `access.device.revoked` with the reason and the sessions it ended.
 * 404 `access.device.notFound`, 409 `access.device.alreadyRevoked`.
 */
export async function revokeDevice(
  tx: TenantTransaction,
  actor: RoleActor,
  change: { readonly deviceId: string; readonly reason: string },
  dependencies: Pick<AccessDependencies, "newId">,
): Promise<DeviceView> {
  const [device] = await tx
    .select({ id: devices.id, revokedAt: devices.revokedAt })
    .from(devices)
    .where(eq(devices.id, change.deviceId))
    .for("update");
  if (device === undefined) throw deviceNotFound();
  if (device.revokedAt !== null) {
    throw new ProblemError(accessProblemCodes.deviceAlreadyRevoked, 409, {
      title: "This device is already revoked",
    });
  }
  await tx
    .update(devices)
    .set({ revokedAt: actor.at, revokedBy: actor.userId, revokeReason: change.reason })
    .where(eq(devices.id, change.deviceId));
  const ended = await tx
    .update(sessions)
    .set({ revokedAt: actor.at, revokedBy: actor.userId })
    .where(and(eq(sessions.deviceId, change.deviceId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await auditAs(tx, actor, dependencies, {
    action: "access.device.revoked",
    entity: { type: "access.device", id: change.deviceId },
    before: { status: "active" },
    after: { status: "revoked", sessionsRevoked: ended.length },
    reason: change.reason,
  });
  const [view] = await selectDevices(tx).where(eq(devices.id, change.deviceId));
  if (view === undefined) throw new Error(`device ${change.deviceId} vanished while revoked`);
  return deviceView(view);
}

/**
 * Records the server's time of a device's push or pull (`last_sync_at`, for the devices
 * screen), in its own transaction. It only moves forward.
 */
export async function recordDeviceSync(
  tenants: TenantDatabase,
  device: Device,
  at: Date,
): Promise<void> {
  await tenants.withTenant({ tenantId: device.tenantId, deviceId: device.deviceId }, (tx) =>
    tx
      .update(devices)
      .set({
        lastSyncAt: sql`greatest(coalesce(${devices.lastSyncAt}, ${at}::timestamptz), ${at}::timestamptz)`,
      })
      .where(eq(devices.id, device.deviceId)),
  );
}

/**
 * A revoked device reports that it wiped its local data (rule 23), once every operation it
 * held had an answer. Recorded once and audited `access.device.wiped` with the device and no
 * user; a repeated report changes nothing. 409 `access.device.notRevoked` for a device that is
 * not revoked.
 */
export async function reportDeviceWiped(
  tenants: TenantDatabase,
  device: Device,
  dependencies: Pick<AccessDependencies, "clock" | "newId">,
): Promise<void> {
  const now = dependencies.clock.now();
  await tenants.withTenant({ tenantId: device.tenantId, deviceId: device.deviceId }, async (tx) => {
    const [row] = await tx
      .select({ revokedAt: devices.revokedAt, wipedAt: devices.wipedAt })
      .from(devices)
      .where(eq(devices.id, device.deviceId))
      .for("update");
    if (row === undefined || row.revokedAt === null) {
      throw new ProblemError(accessProblemCodes.deviceNotRevoked, 409, {
        title: "Only a revoked device wipes its data",
      });
    }
    if (row.wipedAt !== null) return;
    await tx.update(devices).set({ wipedAt: now }).where(eq(devices.id, device.deviceId));
    await recordAudit(tx, {
      id: dependencies.newId(),
      tenantId: device.tenantId,
      branchId: device.branchId,
      occurredAt: now,
      userId: null,
      deviceId: device.deviceId,
      action: "access.device.wiped",
      entity: { type: "access.device", id: device.deviceId },
    });
  });
}

/**
 * When the device was revoked, or `null` while it is not, read in `tx`: push checks it in each
 * operation's own transaction, so an operation received after a revoke is flagged even when its
 * push began before it.
 */
export async function deviceRevokedAt(
  tx: TenantTransaction,
  deviceId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ revokedAt: devices.revokedAt })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (row === undefined) throw new Error(`device ${deviceId} is not in this tenant`);
  return row.revokedAt;
}
