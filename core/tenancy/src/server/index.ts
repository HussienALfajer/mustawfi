export { tenancyModule } from "./manifest.ts";
export {
  openTenantDatabase,
  type TenantContext,
  type TenantDatabase,
  type TenantDatabaseOptions,
  type TenantTransaction,
} from "./tenant-database.ts";
export {
  createTenant,
  type CreatedTenant,
  currentTenant,
  type NewTenant,
  type Tenant,
} from "./tenants.ts";
export {
  activeDepartmentCount,
  archiveDepartment,
  createDepartment,
  defaultDepartment,
  type DepartmentChange,
  activeDepartments,
  lockTenant,
  knownDepartments,
  listDepartments,
  type NewDepartment,
  renameDepartment,
} from "./departments.ts";
export {
  currentLicense,
  currentLicenseStatus,
  installLicense,
  licenseBundlePart,
  licenseReadOnly,
  type LicenseStatus,
  licenseSuspended,
  requireWritableLicense,
  type InstallLicenseDependencies,
  type InstalledLicense,
} from "./licenses.ts";
