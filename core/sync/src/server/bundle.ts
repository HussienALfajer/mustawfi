import type { Device } from "@mustawfi/core-access/server";
import {
  bundleDigest,
  type BundlePart,
  type BundleSigningKey,
  signBundle,
  signServerTime,
} from "@mustawfi/core-config/server";
import type { BundleResponse } from "@mustawfi/core-config/shared";
import {
  currentLicense,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { eq, sql } from "drizzle-orm";
import { bundleVersions } from "./schema.ts";

export interface BundleDependencies {
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** The bundle key, from `BUNDLE_KEY_FILE` (ADR-0021). */
  readonly bundleKey: BundleSigningKey;
  /** The parts of the enabled modules, composed by the host (ADR-0030). */
  readonly bundleParts: readonly BundlePart<TenantTransaction>[];
}

/**
 * The configuration bundle of `device` (`core-foundation` rules 11–12), rebuilt from current
 * data: every part is built in one tenant transaction and its text hashed; the device's version
 * increases when that digest differs from the one last offered. A device that already holds the
 * current version (`known`) gets the version alone. Every answer carries the server's time,
 * signed for the device, for its clock guard (ADR-0021).
 *
 * The row is written only when the digest changed. Two calls for one device at once serialize
 * on its row: the one that loses the race to write the same digest reads the winner's row, and
 * one whose digest no longer matches the row fails, so the next round fetches again — a version
 * is never signed with parts it was not counted for.
 */
export async function deviceBundle(
  tenants: TenantDatabase,
  device: Device,
  known: number,
  dependencies: BundleDependencies,
): Promise<BundleResponse> {
  return tenants.withTenant(
    { tenantId: device.tenantId, deviceId: device.deviceId },
    async (tx) => {
      const parts: Record<string, string> = {};
      for (const part of dependencies.bundleParts) {
        parts[part.name] = JSON.stringify(await part.build(tx, device));
      }
      const license = await currentLicense(tx);
      if (license === undefined) throw new Error("the tenant has no installed license");
      const digest = bundleDigest(parts);
      const offered = () =>
        tx
          .select({
            version: bundleVersions.version,
            issuedAt: bundleVersions.issuedAt,
            digest: bundleVersions.digest,
          })
          .from(bundleVersions)
          .where(eq(bundleVersions.deviceId, device.deviceId));
      let [row] = (await offered()).filter((current) => current.digest === digest);
      if (row === undefined) {
        const now = dependencies.clock.now();
        const stored = sql.identifier("bundle_versions");
        [row] = await tx
          .insert(bundleVersions)
          .values({
            id: dependencies.newId(),
            tenantId: device.tenantId,
            branchId: device.branchId,
            createdAt: now,
            createdBy: null,
            deviceId: device.deviceId,
            version: 1,
            digest,
            issuedAt: now,
          })
          .onConflictDoUpdate({
            target: [bundleVersions.tenantId, bundleVersions.deviceId],
            set: {
              version: sql`${stored}.version + 1`,
              issuedAt: sql`excluded.issued_at`,
              digest: sql`excluded.digest`,
            },
            setWhere: sql`${stored}.digest <> excluded.digest`,
          })
          .returning({
            version: bundleVersions.version,
            issuedAt: bundleVersions.issuedAt,
            digest: bundleVersions.digest,
          });
        // Another call wrote this digest first: its version is this bundle's.
        row ??= (await offered()).find((current) => current.digest === digest);
        if (row === undefined) throw new Error("the bundle changed while it was built");
      }
      const time = await signServerTime(
        device.deviceId,
        dependencies.clock.now(),
        dependencies.bundleKey,
      );
      if (row.version === known) return { version: row.version, bundle: null, time };
      return {
        version: row.version,
        time,
        bundle: await signBundle(
          {
            version: row.version,
            issuedAt: row.issuedAt,
            deviceId: device.deviceId,
            licenseRef: license.id,
            parts,
          },
          dependencies.bundleKey,
        ),
      };
    },
  );
}
