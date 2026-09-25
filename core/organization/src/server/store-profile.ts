import { createHash } from "node:crypto";
import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { recordChange } from "@mustawfi/core-sync/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { eq } from "drizzle-orm";
import {
  LOGO_MAX_BYTES,
  type LogoType,
  logoTypeOf,
  organizationProblemCodes,
  STORE_PROFILE_ENTITY,
  type StoreProfileInput,
  storeProfileInputSchema,
  type StoreProfileView,
} from "../shared/index.ts";
import type { Actor, OrganizationDependencies } from "./departments.ts";
import { storeProfiles } from "./schema.ts";

type StoreProfileRow = typeof storeProfiles.$inferSelect;

/** The profile's columns but the logo bytes. */
const viewColumns = {
  id: storeProfiles.id,
  name: storeProfiles.name,
  address: storeProfiles.address,
  phones: storeProfiles.phones,
  taxNumber: storeProfiles.taxNumber,
  commercialRegister: storeProfiles.commercialRegister,
  logoType: storeProfiles.logoType,
  logoSha256: storeProfiles.logoSha256,
  logoSize: storeProfiles.logoSize,
  updatedAt: storeProfiles.updatedAt,
};

type ViewRow = Pick<StoreProfileRow, keyof typeof viewColumns>;

function toView(row: ViewRow): StoreProfileView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phones: row.phones,
    taxNumber: row.taxNumber,
    commercialRegister: row.commercialRegister,
    logo:
      row.logoType === null || row.logoSha256 === null || row.logoSize === null
        ? null
        : { type: row.logoType as LogoType, sha256: row.logoSha256, size: row.logoSize },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audits a profile change and appends the new profile to the change log devices pull from. */
async function publishProfile(
  tx: TenantTransaction,
  actor: Actor,
  change: { readonly before?: StoreProfileView; readonly after: StoreProfileView },
  dependencies: OrganizationDependencies,
): Promise<void> {
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    action:
      change.before === undefined ? "organization.profile.created" : "organization.profile.changed",
    entity: { type: STORE_PROFILE_ENTITY, id: change.after.id },
    ...(change.before === undefined ? {} : { before: change.before }),
    after: change.after,
  });
  await recordChange(
    tx,
    {
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: actor.at,
      createdBy: actor.userId,
      entity: STORE_PROFILE_ENTITY,
      entityId: change.after.id,
      row: change.after,
    },
    dependencies,
  );
}

/**
 * The store profile of a new tenant, named after it, audited and published: written by the
 * host's tenant creation in the tenant's first transaction.
 */
export async function createStoreProfile(
  tx: TenantTransaction,
  actor: Actor,
  storeName: string,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  const { name } = storeProfileInputSchema.parse({ name: storeName });
  const [row] = await tx
    .insert(storeProfiles)
    .values({
      id: dependencies.newId(),
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: actor.at,
      createdBy: actor.userId,
      name,
      phones: [],
      updatedAt: actor.at,
      updatedBy: actor.userId,
    })
    .returning(viewColumns);
  if (row === undefined) throw new Error("the store profile insert returned no row");
  const after = toView(row);
  await publishProfile(tx, actor, { after }, dependencies);
  return after;
}

/** The store profile of the tenant `tx` runs in, locked for a change when `forUpdate`. */
export async function storeProfile(
  tx: TenantTransaction,
  options: { readonly forUpdate?: boolean } = {},
): Promise<StoreProfileView> {
  const query = tx.select(viewColumns).from(storeProfiles);
  const [row] = await (options.forUpdate === true ? query.for("update") : query);
  if (row === undefined) throw new Error("the tenant has no store profile");
  return toView(row);
}

async function update(
  tx: TenantTransaction,
  actor: Actor,
  values: Partial<typeof storeProfiles.$inferInsert>,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  const before = await storeProfile(tx, { forUpdate: true });
  const [row] = await tx
    .update(storeProfiles)
    .set({ ...values, updatedAt: actor.at, updatedBy: actor.userId })
    .where(eq(storeProfiles.id, before.id))
    .returning(viewColumns);
  if (row === undefined) throw new Error("the store profile update returned no row");
  const after = toView(row);
  await publishProfile(tx, actor, { before, after }, dependencies);
  return after;
}

/** Replaces the profile's fields but the logo, audited with before and after. */
export async function editStoreProfile(
  tx: TenantTransaction,
  actor: Actor,
  input: StoreProfileInput,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  const values = storeProfileInputSchema.parse(input);
  return update(tx, actor, values, dependencies);
}

/**
 * Sets the logo from its bytes: a PNG or JPEG by its signature (422
 * `organization.logo.unsupportedType`), at most `LOGO_MAX_BYTES` (422 `organization.logo.tooLarge`).
 */
export async function setStoreLogo(
  tx: TenantTransaction,
  actor: Actor,
  bytes: Uint8Array,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new ProblemError(organizationProblemCodes.logoTooLarge, 422, {
      title: "The logo is too large",
      detail: `a logo is at most ${LOGO_MAX_BYTES} bytes`,
    });
  }
  const type = logoTypeOf(bytes);
  if (type === undefined) {
    throw new ProblemError(organizationProblemCodes.logoUnsupportedType, 422, {
      title: "The logo is not a PNG or JPEG image",
    });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return update(
    tx,
    actor,
    { logo: bytes, logoType: type, logoSha256: sha256, logoSize: bytes.length },
    dependencies,
  );
}

/** Removes the logo, audited. */
export async function removeStoreLogo(
  tx: TenantTransaction,
  actor: Actor,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  return update(
    tx,
    actor,
    { logo: null, logoType: null, logoSha256: null, logoSize: null },
    dependencies,
  );
}

/** The logo's bytes and type, or `undefined` when the store has none. */
export async function storeLogo(
  tx: TenantTransaction,
): Promise<{ readonly type: LogoType; readonly bytes: Uint8Array } | undefined> {
  const [row] = await tx
    .select({ logo: storeProfiles.logo, type: storeProfiles.logoType })
    .from(storeProfiles);
  if (row?.logo == null || row.type === null) return undefined;
  return { type: row.type as LogoType, bytes: row.logo };
}
