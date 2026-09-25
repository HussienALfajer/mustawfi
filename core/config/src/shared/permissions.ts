import { z } from "zod";

/**
 * The role templates a module's permission or limit may be granted to by default
 * (`core-foundation` rules 13–14). The owner is not among them: the owner role holds every
 * permission and no limit. `core.access` seeds one editable role per template with each tenant.
 */
export const ROLE_TEMPLATES = [
  "accountant",
  "sectionCashier",
  "repairTechnician",
  "topUpOperator",
] as const;

export const roleTemplateSchema = z.enum(ROLE_TEMPLATES);
export type RoleTemplate = z.infer<typeof roleTemplateSchema>;

const DOTTED_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;

/**
 * A permission (`inventory.products.view`) or limit (`sales.discount.maxPercent`): two to four
 * camelCase segments, the first naming the declaring module without `core.` (`audit.view` is
 * `core.audit`'s).
 */
export const permissionIdSchema = z
  .string()
  .regex(DOTTED_ID, "a permission is two to four dotted camelCase segments");
export const limitIdSchema = z
  .string()
  .regex(DOTTED_ID, "a limit is two to four dotted camelCase segments");

/** What a limit's value measures (`core-foundation` rule 16). */
export const limitKindSchema = z.enum(["percent", "amount", "count"]);
export type LimitKind = z.infer<typeof limitKindSchema>;

/** A limit's value: a non-negative decimal string, as stored on the role (`numeric(20,4)`). */
export const limitValueSchema = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,4})?$/, "a limit value is a non-negative decimal");

/** A permission as a module declares it in its manifest. */
export interface PermissionDeclaration {
  readonly id: string;
  /**
   * A scoped permission holds only in the user's departments; an unscoped one ignores the
   * scope (`core-foundation` rule 15). Unscoped when omitted.
   */
  readonly scoped?: boolean;
  /** The templates whose seeded roles hold it. */
  readonly grants?: readonly RoleTemplate[];
}

/** A limit as a module declares it in its manifest. */
export interface LimitDeclaration {
  readonly id: string;
  readonly kind: LimitKind;
  /** The value each template's seeded role starts with; a template left out has none (zero). */
  readonly grants?: Readonly<Partial<Record<RoleTemplate, string>>>;
}

export interface DeclaredPermission {
  readonly id: string;
  readonly moduleId: string;
  readonly scoped: boolean;
  readonly grants: readonly RoleTemplate[];
}

export interface DeclaredLimit {
  readonly id: string;
  readonly moduleId: string;
  readonly kind: LimitKind;
  readonly grants: Readonly<Partial<Record<RoleTemplate, string>>>;
}

/**
 * Every permission and limit the registered modules declare, by id. A check against anything
 * else is a programming error (`core-foundation` rule 13).
 */
export interface PermissionCatalogue {
  readonly permissions: ReadonlyMap<string, DeclaredPermission>;
  readonly limits: ReadonlyMap<string, DeclaredLimit>;
}

/** The first segment a module's permission and limit ids carry: `core.audit` → `audit`. */
export function permissionPrefix(moduleId: string): string {
  return moduleId.replace(/^core\./, "");
}
