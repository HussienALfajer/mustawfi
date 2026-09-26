import { activeDeviceCount, activeUserCount } from "@mustawfi/core-access/server";
import {
  activeDepartmentCount,
  currentLicenseStatus,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { licenseStateStarts } from "@mustawfi/core-tenancy/shared";
import { LICENSE_LIMITS, type LicenseLimitName, type LicenseSummary } from "../shared/index.ts";

/**
 * The «License and plan» summary of the tenant `tx` runs in at `at`, the server clock's instant
 * (`core-foundation` rules 3 and 4): each limit is counted the way its enforcement counts it —
 * active users (owners included), active departments, devices not revoked.
 */
export async function licenseSummary(tx: TenantTransaction, at: Date): Promise<LicenseSummary> {
  const { license, state } = await currentLicenseStatus(tx, at);
  const starts = licenseStateStarts(license.claims);
  const used: Record<LicenseLimitName, number> = {
    users: await activeUserCount(tx),
    departments: await activeDepartmentCount(tx),
    mainPosDevices: await activeDeviceCount(tx, "mainPos"),
    companionDevices: await activeDeviceCount(tx, "companion"),
  };
  const { limits } = license.claims;
  return {
    plan: license.claims.plan,
    state,
    expiresAt: license.claims.expiresAt,
    readOnlyAt: new Date(starts.readOnly).toISOString(),
    suspendedAt: new Date(starts.suspended).toISOString(),
    limits: LICENSE_LIMITS.map((limit) => ({
      limit,
      used: used[limit],
      allowed: limits[limit],
    })),
  };
}
