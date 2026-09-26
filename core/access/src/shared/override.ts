import {
  limitIdSchema,
  limitValueSchema,
  type PermissionCatalogue,
  permissionIdSchema,
} from "@mustawfi/core-config/shared";
import { Decimal } from "@mustawfi/kernel";
import { z } from "zod";
import type { AccessGrant } from "./grant.ts";

/**
 * What an action needs (`core-foundation` rule 18): a permission — in a department when the
 * permission is scoped — and, for an action that goes up to a value, that value within a limit.
 */
export interface OverrideRequest {
  readonly permission: string;
  /** Where the action happens; needed for a scoped permission. */
  readonly departmentId?: string | undefined;
  /** The value the action reaches, against the limit that bounds it. */
  readonly limit?: { readonly id: string; readonly value: string } | undefined;
}

/**
 * Whether `grant` covers `request`: the permission, in the department when it is scoped, and the
 * value within the limit — the owner is unlimited, and a role without a value may not go beyond
 * zero (rule 16). What `catalogue` does not declare, and a scoped permission asked without a
 * department, cover nothing: a supervisor override read from a device's payload may name
 * anything, so this never throws.
 */
export function grantCovers(
  catalogue: PermissionCatalogue,
  grant: AccessGrant,
  request: OverrideRequest,
): boolean {
  const declared = catalogue.permissions.get(request.permission);
  if (declared === undefined) return false;
  if (declared.scoped && request.departmentId === undefined) return false;
  if (!grant.can(request.permission, request.departmentId)) return false;
  if (request.limit === undefined) return true;
  if (!catalogue.limits.has(request.limit.id)) return false;
  const value = limitValueSchema.safeParse(request.limit.value);
  if (!value.success) return false;
  const held = grant.limitFor(request.limit.id);
  return held.unlimited || !Decimal.of(value.data).greaterThan(Decimal.of(held.value));
}

/**
 * A supervisor override as a document carries it (rule 18): who approved which action, where,
 * up to which value, and when (the device's clock). The device checked the supervisor's PIN and
 * role when it was granted; the server checks the role again at ingest and flags the document
 * `overrideNotAuthorized` when it does not cover the override.
 */
export const supervisorOverrideSchema = z.strictObject({
  /** Generated on the device; the audit entry of the grant names it. */
  id: z.uuid(),
  approverId: z.uuid(),
  permission: permissionIdSchema,
  departmentId: z.uuid().optional(),
  limit: z.strictObject({ id: limitIdSchema, value: limitValueSchema }).optional(),
  grantedAt: z.iso.datetime(),
});

export type SupervisorOverride = z.infer<typeof supervisorOverrideSchema>;

/** The overrides one document carries: at most one per action it needed. */
export const supervisorOverridesSchema = z.array(supervisorOverrideSchema).max(20);

/** What an override approved, as a request `grantCovers` checks. */
export function overrideRequestOf(override: SupervisorOverride): OverrideRequest {
  return {
    permission: override.permission,
    departmentId: override.departmentId,
    limit: override.limit,
  };
}

/**
 * The device events of a supervisor override (rules 18 and 33), through the device audit path:
 * granted, or refused because the supervisor's role does not cover it. A wrong PIN is
 * `access.pin.failed`, as for any PIN checked on the device.
 */
export const OVERRIDE_DEVICE_EVENTS = {
  granted: { action: "access.override.granted" },
  refused: { action: "access.override.refused" },
} as const;
