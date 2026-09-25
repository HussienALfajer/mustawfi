import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import {
  currentTenant,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { randomIndex, UNAMBIGUOUS_ALPHABET } from "@mustawfi/kernel";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  accessProblemCodes,
  deviceNameSchema,
  deviceTypeSchema,
  type DeviceType,
} from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { devices, registrationCodes } from "./schema.ts";
import { bearerToken } from "./sessions.ts";
import {
  issueBearer,
  issueRegistrationSecret,
  readBearer,
  registrationCodeHash,
} from "./secrets.ts";

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
  const { token: code, hash } = issueRegistrationSecret(dependencies.random);
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
 * racing with one code get one registration. The device gets a prefix no device of the
 * tenant has ever had, chosen at random among the free ones, and a fresh credential. A
 * refusal throws and rolls everything back.
 */
export async function registerDevice(
  tx: TenantTransaction,
  device: NewDevice,
  dependencies: AccessDependencies,
): Promise<RegisteredDevice> {
  const type = deviceTypeSchema.parse(device.type);
  const name = deviceNameSchema.parse(device.name);
  const codeHash = registrationCodeHash(device.registrationCode);
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

  // One registration at a time per tenant, so two cannot pick the same free prefix.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`core_access.devices:${device.tenantId}`}, 0))`,
  );
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

/** An authenticated device. */
export interface Device {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly prefix: string;
  readonly type: DeviceType;
  readonly name: string;
}

/** The device a credential belongs to, or `undefined` for a malformed or unknown one. */
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
      })
      .from(devices)
      .where(eq(devices.credentialHash, bearer.hash)),
  );
  return row === undefined ? undefined : { ...row, type: deviceTypeSchema.parse(row.type) };
}

/**
 * The device of a request's `Authorization: Bearer` device credential, or a 401
 * `access.device.required` — the same refusal whatever was wrong with it. Sync calls this:
 * a device syncs as itself, and each operation names the user who performed it (ADR-0022).
 */
export async function requireDevice(
  request: { readonly headers: { readonly authorization?: string | undefined } },
  context: { readonly tenants: TenantDatabase },
): Promise<Device> {
  const credential = bearerToken(request.headers.authorization);
  const device =
    credential === undefined ? undefined : await authenticateDevice(context.tenants, credential);
  if (device === undefined) {
    throw new ProblemError(accessProblemCodes.deviceRequired, 401, {
      title: "This device is not registered",
    });
  }
  return device;
}
