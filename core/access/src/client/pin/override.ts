import { type BundleVerifier, loadBundle } from "@mustawfi/core-config/client";
import type { IdGenerator } from "@mustawfi/kernel";
import type { LocalDb } from "@mustawfi/local-db";
import {
  accessGrant,
  type AccessPart,
  bundleUserAccess,
  catalogueFromView,
  grantCovers,
  OVERRIDE_DEVICE_EVENTS,
  type OverrideRequest,
  type SupervisorOverride,
} from "../../shared/index.ts";
import { localDevice } from "../device.ts";
import {
  accessPartOf,
  bundleUser,
  checkPinLocally,
  type LocalPinDependencies,
  type LocalPinOutcome,
} from "./local-sign-in.ts";

/**
 * Whether `userId`'s role, as the bundle describes it, covers `request` (`core-foundation` rule
 * 18) — the same resolution the server makes at ingest.
 */
export function bundleCovers(
  access: AccessPart,
  userId: string,
  request: OverrideRequest,
): boolean {
  const held = bundleUserAccess(access, userId);
  if (held === undefined) return false;
  const catalogue = catalogueFromView(access.catalogue);
  return grantCovers(catalogue, accessGrant(catalogue, held), request);
}

export interface OverrideDependencies extends LocalPinDependencies {
  readonly newId: IdGenerator;
}

/** What a supervisor's override came to. */
export type OverrideOutcome =
  | Exclude<LocalPinOutcome, { readonly outcome: "verified" }>
  /** The supervisor's PIN was right and their role covers the action: attach `override`. */
  | { readonly outcome: "granted"; readonly override: SupervisorOverride }
  /** The supervisor's PIN was right, but their role does not cover the action (audited). */
  | { readonly outcome: "notCovered" }
  /** The one asking cannot approve their own action. */
  | { readonly outcome: "notAllowed" };

/**
 * A supervisor approves `request` for `requestedBy` on this device (flow 15, rule 18): they pick
 * their name and enter their PIN, checked on the device against the bundle like any PIN — a
 * wrong one counts against them. With the right PIN, the override holds when their role covers
 * the action, in its department, up to its value; granted or refused, it is audited on the
 * device path as the supervisor's, in the transaction that checks the PIN. The server checks the
 * approver's role again when the document arrives.
 */
export async function grantOverride(
  db: LocalDb,
  access: AccessPart,
  input: {
    readonly request: OverrideRequest;
    readonly requestedBy: string;
    readonly supervisorId: string;
    readonly pin: string;
  },
  dependencies: OverrideDependencies,
): Promise<OverrideOutcome> {
  if (bundleUser(access, input.supervisorId) === undefined) return { outcome: "unavailable" };
  if (input.supervisorId === input.requestedBy) return { outcome: "notAllowed" };
  const { request } = input;
  const result: { granted?: SupervisorOverride } = {};
  const outcome = await checkPinLocally(
    db,
    access,
    input.supervisorId,
    input.pin,
    dependencies,
    async (tx) => {
      const id = dependencies.newId();
      const approved = {
        permission: request.permission,
        ...(request.departmentId === undefined ? {} : { departmentId: request.departmentId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      };
      const covers = bundleCovers(access, input.supervisorId, request);
      await dependencies.audit.record(tx, {
        action: covers
          ? OVERRIDE_DEVICE_EVENTS.granted.action
          : OVERRIDE_DEVICE_EVENTS.refused.action,
        userId: input.supervisorId,
        entity: { type: "access.override", id },
        after: { requestedBy: input.requestedBy, ...approved },
      });
      if (covers) {
        result.granted = {
          id,
          approverId: input.supervisorId,
          ...approved,
          grantedAt: dependencies.clock.now().toISOString(),
        };
      }
    },
  );
  if (outcome.outcome !== "verified") return outcome;
  return result.granted === undefined
    ? { outcome: "notCovered" }
    : { outcome: "granted", override: result.granted };
}

/** `grantOverride` against this device's verified bundle. */
export async function overrideOnDevice(
  db: LocalDb,
  input: Parameters<typeof grantOverride>[2],
  dependencies: OverrideDependencies & { readonly verifier: BundleVerifier },
): Promise<OverrideOutcome | { readonly outcome: "noBundle" }> {
  const device = await localDevice(db);
  if (device === undefined) throw new Error("an override needs a registered device");
  const access = accessPartOf(
    await loadBundle(db, dependencies.verifier, {
      deviceId: device.deviceId,
      tenantId: device.tenantId,
    }),
  );
  if (access === undefined) return { outcome: "noBundle" };
  return grantOverride(db, access, input, dependencies);
}
