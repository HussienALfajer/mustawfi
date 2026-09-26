import { z } from "zod";

/** The name of the default department seeded with every tenant (`core-foundation` rule 28). */
export const DEFAULT_DEPARTMENT_NAME = "المتجر";

export const departmentNameSchema = z.string().trim().min(1).max(100);

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
  /** Another active department has this name. */
  departmentNameTaken: "tenancy.department.nameTaken",
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
