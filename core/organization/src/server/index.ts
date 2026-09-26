export { organizationBundlePart } from "./bundle-part.ts";
export type { OrganizationContext } from "./dependencies.ts";
export {
  type Actor,
  addDepartment,
  changeDepartmentName,
  type OrganizationDependencies,
  publishDepartment,
  retireDepartment,
} from "./departments.ts";
export { organizationModule } from "./manifest.ts";
export { type NumberGap, trackDocumentNumber, type TrackedDocument } from "./numbering.ts";
export { seedOrganization } from "./seed.ts";
export {
  createStoreProfile,
  editStoreProfile,
  removeStoreLogo,
  setStoreLogo,
  storeLogo,
  storeProfile,
} from "./store-profile.ts";
