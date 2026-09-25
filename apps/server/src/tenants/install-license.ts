import { recordAudit } from "@mustawfi/core-audit/server";
import type { AuditValues } from "@mustawfi/core-audit/shared";
import {
  currentLicense,
  currentTenant,
  type InstalledLicense,
  installLicense,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import type { LicensePublicKeys } from "@mustawfi/core-tenancy/shared";
import type { Clock, IdGenerator } from "@mustawfi/kernel";

export interface LicenseDependencies {
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** The public license keys from configuration (`LICENSE_PUBLIC_KEYS`); no built-in default. */
  readonly licenseKeys: LicensePublicKeys;
}

/** What the audit log keeps of a license: its claims and key id, not the token. */
export function licenseAuditValues(license: InstalledLicense): AuditValues {
  return { kid: license.kid, ...license.claims };
}

/**
 * Installs `jws` in `tx` and audits it (`tenancy.license.installed`) with the license it
 * replaces. No user of the tenant acts: Vertex staff install licenses (ADR-0030).
 */
export async function installAuditedLicense(
  tx: TenantTransaction,
  jws: string,
  dependencies: LicenseDependencies,
): Promise<InstalledLicense> {
  const previous = await currentLicense(tx);
  const installed = await installLicense(tx, { jws }, dependencies);
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("a license was installed without a tenant");
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: tenant.id,
    branchId: tenant.defaultBranchId,
    occurredAt: installed.installedAt,
    userId: null,
    action: "tenancy.license.installed",
    entity: { type: "tenancy.license", id: installed.id },
    ...(previous === undefined ? {} : { before: licenseAuditValues(previous) }),
    after: licenseAuditValues(installed),
  });
  return installed;
}

export class UnknownStoreError extends Error {
  override name = "UnknownStoreError";
}

/**
 * `license:install` (ADR-0030): installs a renewed or changed license for the store a code
 * names. `installLicense` refuses a license for another tenant, so the code and the license
 * must agree.
 */
export async function installTenantLicense(
  tenants: TenantDatabase,
  input: { readonly storeCode: string; readonly license: string },
  dependencies: LicenseDependencies,
): Promise<InstalledLicense> {
  const tenantId = await tenants.resolveStoreCode(input.storeCode);
  if (tenantId === undefined) throw new UnknownStoreError(`no store has code ${input.storeCode}`);
  return tenants.withTenant({ tenantId }, (tx) =>
    installAuditedLicense(tx, input.license, dependencies),
  );
}
