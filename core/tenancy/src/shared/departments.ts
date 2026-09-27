import { recordNameSchema } from "@mustawfi/core-config/shared";
import { z } from "zod";

/** The name of the default department seeded with every tenant (`core-foundation` rule 28). */
export const DEFAULT_DEPARTMENT_NAME = "المتجر";

/**
 * A department's name: stored with its spaces collapsed, and unique among all of the tenant's
 * departments, archived ones included, compared case-insensitively (`core-foundation` slice 20).
 */
export const departmentNameSchema = recordNameSchema;

/** A department as its managers and devices see it. */
export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.int(),
  /** When it was archived; archived departments keep their history. */
  archivedAt: z.iso.datetime().nullable(),
});

export type DepartmentView = z.infer<typeof departmentSchema>;

/** The refusals of `core.tenancy`; clients map each code to an Arabic message. */
export const tenancyProblemCodes = {
  /** A new active department would exceed the license's `departments` limit (rule 4). */
  departmentLimit: "tenancy.limit.departments",
  /** A new or reactivated user would exceed the license's `users` limit (rule 4). */
  userLimit: "tenancy.limit.users",
  /** A new main POS device would exceed the license's `mainPosDevices` limit (rule 4). */
  mainPosDeviceLimit: "tenancy.limit.mainPosDevices",
  /** A new companion device would exceed the license's `companionDevices` limit (rule 4). */
  companionDeviceLimit: "tenancy.limit.companionDevices",
  /**
   * A write refused while the license is read-only or suspended (rule 5); sign-in, sign-out, the
   * user's own account, push, and routes marked `allowedWhenReadOnly` stay open.
   */
  licenseReadOnly: "tenancy.license.readOnly",
  /** The license is suspended: only owners' sessions are accepted (rule 5). */
  licenseSuspended: "tenancy.license.suspended",
  /** Another active department has this name (compared as `nameKey` does). */
  departmentNameTaken: "tenancy.department.nameTaken",
  /** An archived department has this name: restore it instead of adding another. */
  departmentNameArchived: "tenancy.department.nameArchived",
  /** Only an archived department is restored. */
  departmentNotArchived: "tenancy.department.notArchived",
  /** No department with this id in the tenant. */
  departmentNotFound: "tenancy.department.notFound",
  /** The department is archived: it cannot be renamed or archived again. */
  departmentArchived: "tenancy.department.archived",
  /** The default department is never archived (rule 28). */
  defaultDepartment: "tenancy.department.default",
  /** The last active department is never archived (rule 28). */
  lastActiveDepartment: "tenancy.department.lastActive",
} as const;

export type TenancyProblemCode = (typeof tenancyProblemCodes)[keyof typeof tenancyProblemCodes];
