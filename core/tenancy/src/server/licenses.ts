import type { BundlePart } from "@mustawfi/core-config/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { desc } from "drizzle-orm";
import {
  LICENSE_BUNDLE_PART,
  type LicenseClaims,
  type LicensePublicKeys,
  LicenseRefusedError,
  verifyLicense,
} from "../shared/index.ts";
import { licenses, tenants } from "./schema.ts";
import type { TenantTransaction } from "./tenant-database.ts";
import { currentTenant } from "./tenants.ts";

export interface InstalledLicense {
  readonly id: string;
  /** The signed license as issued: the claims' source. */
  readonly jws: string;
  readonly kid: string;
  readonly claims: LicenseClaims;
  readonly installedAt: Date;
}

export interface InstallLicenseDependencies {
  /** The public license keys by key id, from configuration; never a built-in default. */
  readonly licenseKeys: LicensePublicKeys;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/**
 * Installs a license for the tenant `tx` runs in (ADR-0030, `core-foundation` rule 1): it
 * must verify against a configured public key, name this tenant, be valid already, and be
 * issued after the installed license. Refusals throw `LicenseRefusedError`. The caller audits.
 */
export async function installLicense(
  tx: TenantTransaction,
  license: { readonly jws: string; readonly installedBy?: string },
  dependencies: InstallLicenseDependencies,
): Promise<InstalledLicense> {
  const { kid, claims } = await verifyLicense(license.jws, dependencies.licenseKeys);
  const tenant = await currentTenant(tx);
  if (tenant === undefined || tenant.id !== claims.tenant) {
    throw new LicenseRefusedError("otherTenant", "the license names another tenant");
  }
  // One install at a time per tenant, so two cannot both pass the newer-than check.
  await tx.select({ id: tenants.id }).from(tenants).for("update");
  const installedAt = dependencies.clock.now();
  if (Date.parse(claims.notBefore) > installedAt.getTime()) {
    throw new LicenseRefusedError("notYetValid", `the license is valid from ${claims.notBefore}`);
  }
  const installed = await currentLicense(tx);
  if (
    installed !== undefined &&
    Date.parse(claims.issuedAt) <= Date.parse(installed.claims.issuedAt)
  ) {
    throw new LicenseRefusedError(
      "notNewer",
      `the installed license was issued at ${installed.claims.issuedAt}`,
    );
  }

  const id = dependencies.newId();
  await tx.insert(licenses).values({
    id,
    tenantId: tenant.id,
    branchId: tenant.defaultBranchId,
    jws: license.jws.trim(),
    kid,
    plan: claims.plan,
    issuedAt: new Date(claims.issuedAt),
    notBefore: new Date(claims.notBefore),
    expiresAt: new Date(claims.expiresAt),
    graceDays: claims.graceDays,
    readOnlyDays: claims.readOnlyDays,
    maxOfflineDays: claims.maxOfflineDays,
    limits: claims.limits,
    entitlements: claims.entitlements,
    installedAt,
    installedBy: license.installedBy ?? null,
  });
  return { id, jws: license.jws.trim(), kid, claims, installedAt };
}

/**
 * The current license of the tenant `tx` runs in: the newest installed, whose claims were
 * verified when it was installed.
 */
export async function currentLicense(tx: TenantTransaction): Promise<InstalledLicense | undefined> {
  const [row] = await tx
    .select()
    .from(licenses)
    // Each install is issued after the one before it, so the newest installed is the one issued
    // last — whatever the server clock said at each install.
    .orderBy(desc(licenses.issuedAt))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jws: row.jws,
    kid: row.kid,
    installedAt: row.installedAt,
    claims: {
      tenant: row.tenantId,
      plan: row.plan,
      issuedAt: row.issuedAt.toISOString(),
      notBefore: row.notBefore.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      graceDays: row.graceDays,
      readOnlyDays: row.readOnlyDays,
      maxOfflineDays: row.maxOfflineDays,
      limits: row.limits as LicenseClaims["limits"],
      entitlements: row.entitlements as LicenseClaims["entitlements"],
    },
  };
}

/**
 * The bundle's `license` part (ADR-0030): the installed license as issued, so devices verify it
 * with the license keys themselves — the bundle key cannot vouch for a license (ADR-0021).
 */
export const licenseBundlePart: BundlePart<TenantTransaction> = {
  name: LICENSE_BUNDLE_PART,
  async build(tx) {
    const license = await currentLicense(tx);
    if (license === undefined) throw new Error("the tenant has no installed license");
    return license.jws;
  },
};
