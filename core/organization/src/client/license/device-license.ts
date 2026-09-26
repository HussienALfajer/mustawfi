import { ACCESS_DEVICE_TABLE, localDevice } from "@mustawfi/core-access/client";
import {
  type BundleVerifier,
  CONFIG_BUNDLE_REFUSAL_TABLE,
  CONFIG_BUNDLE_TABLE,
  loadBundle,
} from "@mustawfi/core-config/client";
import {
  CLOCK_GUARD_TABLE,
  type DeviceLicense,
  deviceLicense,
  type DeviceLicenseAudit,
  LICENSE_DAY_TABLE,
  openLicenseDay,
} from "@mustawfi/core-tenancy/client";
import type { Clock } from "@mustawfi/kernel";
import type { LocalDb } from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";

/**
 * The license as this device applies it (`core-foundation` rules 6–11), from the bundle it
 * verifies as it reads it (ADR-0021); `undefined` when this client is no registered device, whose
 * documents it does not make (the server's own gate applies to it). With `audit` (a user signed
 * in), the reading audits the license and clock events it notices (rule 33).
 */
async function readDeviceLicense(
  db: LocalDb,
  verifier: BundleVerifier,
  clock: Clock,
  opening: boolean,
  audit: DeviceLicenseAudit | undefined,
): Promise<DeviceLicense | undefined> {
  const device = await localDevice(db);
  if (device === undefined) return undefined;
  const loaded = await loadBundle(db, verifier, {
    deviceId: device.deviceId,
    tenantId: device.tenantId,
  });
  return opening
    ? openLicenseDay(db, loaded, clock, audit)
    : deviceLicense(db, loaded, clock, audit);
}

/** At a sign-in on this device, or when the app opens with a session (rule 6). */
export function openDeviceLicenseDay(
  db: LocalDb,
  verifier: BundleVerifier,
  clock: Clock,
  audit: DeviceLicenseAudit | undefined,
): Promise<DeviceLicense | undefined> {
  return readDeviceLicense(db, verifier, clock, true, audit);
}

/** The restriction on new documents now, checked right before one is made (ADR-0021). */
export async function deviceLicenseRestriction(
  db: LocalDb,
  verifier: BundleVerifier,
  clock: Clock,
  audit: DeviceLicenseAudit | undefined,
): Promise<DeviceLicense["restriction"]> {
  const license = await readDeviceLicense(db, verifier, clock, false, audit);
  // No registered device makes no document: the sale refuses it for that reason itself.
  return license === undefined ? null : license.restriction;
}

export const deviceLicenseQueryKey = ["local", "tenancy", "license"] as const;

/**
 * The device's license for screens: `null` on a client that is no registered device. It reads
 * the clock too, so it is read again every minute, not only when its tables change — and audits
 * what it notices for the signed-in user (`audit`), since the screens read it all day.
 */
export function deviceLicenseQueryOptions(
  db: LocalDb,
  verifier: BundleVerifier,
  clock: Clock,
  audit: DeviceLicenseAudit | undefined,
) {
  return queryOptions({
    queryKey: deviceLicenseQueryKey,
    queryFn: async () => (await readDeviceLicense(db, verifier, clock, false, audit)) ?? null,
    networkMode: "always",
    refetchInterval: 60_000,
    meta: {
      localTables: [
        ACCESS_DEVICE_TABLE,
        CONFIG_BUNDLE_TABLE,
        CONFIG_BUNDLE_REFUSAL_TABLE,
        CLOCK_GUARD_TABLE,
        LICENSE_DAY_TABLE,
      ],
    },
  });
}
