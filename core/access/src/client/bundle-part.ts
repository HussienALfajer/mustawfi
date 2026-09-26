import type { BundlePartDecoder } from "@mustawfi/core-config/client";
import { ACCESS_BUNDLE_PART, type AccessPart, accessPartSchema } from "../shared/index.ts";

/**
 * The device's reading of the bundle's `access` part: well-formed, and every user's role is
 * among the part's roles, so a sign-in never meets a user without one.
 */
export const accessBundlePart: BundlePartDecoder<AccessPart> = {
  name: ACCESS_BUNDLE_PART,
  decode(value) {
    const part = accessPartSchema.parse(value);
    const roles = new Set(part.roles.map((role) => role.id));
    for (const user of part.users) {
      if (!roles.has(user.roleId)) throw new Error(`user ${user.id} has no role in the part`);
    }
    return part;
  },
};
