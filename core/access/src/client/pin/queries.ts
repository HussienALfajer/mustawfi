import {
  type BundleVerifier,
  CONFIG_BUNDLE_REFUSAL_TABLE,
  CONFIG_BUNDLE_TABLE,
  loadBundle,
} from "@mustawfi/core-config/client";
import type { LocalDb } from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { ACCESS_DEVICE_TABLE, localDevice } from "../device.ts";
import {
  accessPartOf,
  LOCAL_SESSION_TABLE,
  type LocalSession,
  localSession,
  lockedOutUsers,
  mayUnlock,
  PIN_LOCKOUT_TABLE,
} from "./local-sign-in.ts";

/** A name tile of the PIN screen: a user allowed on this device who has a PIN. */
export interface PinTile {
  readonly id: string;
  readonly name: string;
  readonly roleName: string;
  /** Locked out on this device (rule 20); the server lifts it when it answers. */
  readonly locked: boolean;
  /** Their role may unlock others here (`access.users.unlock`, or the owner). */
  readonly mayUnlock: boolean;
}

export interface PinScreenData {
  /** False on a client that is no registered device: PIN sign-in needs one. */
  readonly registered: boolean;
  /** Whether a verified bundle is at hand (the valid one, or the previous one kept). */
  readonly hasBundle: boolean;
  /** By name. */
  readonly tiles: readonly PinTile[];
  /** Who is signed in on this device, for a reconnect (rule 25). */
  readonly session: LocalSession | undefined;
}

async function pinScreenData(db: LocalDb, verifier: BundleVerifier): Promise<PinScreenData> {
  const device = await localDevice(db);
  if (device === undefined) {
    return { registered: false, hasBundle: false, tiles: [], session: undefined };
  }
  const access = accessPartOf(
    await loadBundle(db, verifier, { deviceId: device.deviceId, tenantId: device.tenantId }),
  );
  const session = await localSession(db);
  if (access === undefined) return { registered: true, hasBundle: false, tiles: [], session };
  const locked = await lockedOutUsers(db, access);
  const roles = new Map(access.roles.map((role) => [role.id, role]));
  const tiles = access.users
    .filter((user) => user.pinVerifier !== null)
    .map((user): PinTile => {
      const role = roles.get(user.roleId);
      return {
        id: user.id,
        name: user.name,
        roleName: role?.name ?? "",
        locked: locked.has(user.id),
        mayUnlock: role !== undefined && mayUnlock(role),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { registered: true, hasBundle: true, tiles, session };
}

export const pinScreenQueryKey = ["local", "access", "pinScreen"] as const;

/** What the PIN screen shows, from the local database and the verified bundle. */
export function pinScreenQueryOptions(db: LocalDb, verifier: BundleVerifier) {
  return queryOptions({
    queryKey: pinScreenQueryKey,
    queryFn: () => pinScreenData(db, verifier),
    networkMode: "always",
    meta: {
      localTables: [
        PIN_LOCKOUT_TABLE,
        LOCAL_SESSION_TABLE,
        ACCESS_DEVICE_TABLE,
        CONFIG_BUNDLE_TABLE,
        CONFIG_BUNDLE_REFUSAL_TABLE,
      ],
    },
  });
}
