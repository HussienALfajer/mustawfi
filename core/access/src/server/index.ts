export type { Manager } from "./actor.ts";
export type { AccessContext, AccessDependencies } from "./dependencies.ts";
export {
  authenticateDevice,
  deviceRevokedAt,
  DEVICE_PREFIXES,
  type Device,
  issueRegistrationCode,
  type IssuedRegistrationCode,
  listDevices,
  type NewDevice,
  recordDeviceSync,
  REGISTRATION_CODE_LIFETIME_MS,
  registerDevice,
  type RegisteredDevice,
  reportDeviceWiped,
  revokeDevice,
} from "./devices.ts";
export {
  type LoggedIn,
  logIn,
  type LoginInput,
  logInWithPin,
  type PinLoginInput,
  type SignInDependencies,
  type SignInSource,
} from "./login.ts";
export {
  type IssuedResetCode,
  issueResetCode,
  RESET_CODE_LIFETIME_MS,
  ResetCodeRefused,
  type ResetCodeRequest,
} from "./reset-codes.ts";
export {
  ADDRESS_FAILURE_LIMIT,
  LOGIN_FAILURE_LIMIT,
  SIGN_IN_WINDOW_MS,
  signInThrottles,
  type SignInThrottles,
} from "./throttle.ts";
export { accessModule } from "./manifest.ts";
export { hashPassword, hashPin } from "./passwords.ts";
export {
  openSecret,
  parseTotpKeys,
  sealSecret,
  type TotpKeyRing,
  TotpKeysInvalid,
} from "./sealed-secrets.ts";
export {
  archiveRole,
  copyRole,
  createRole,
  editRole,
  listRoles,
  type NewRole,
  type RoleActor,
  SEEDED_ROLE_NAMES,
  type SeededRoles,
  seedRoles,
} from "./roles.ts";
export {
  deviceOf,
  installRouteAccess,
  permissionDenied,
  type RouteAccess,
  type RouteAccessContext,
  type RouteAccessEntry,
  routeAccessTable,
  sessionOf,
} from "./route-access.ts";
export {
  authenticateSession,
  openSession,
  type OpenedSession,
  revokeSession,
  type Session,
  SESSION_LIFETIME_MS,
  SESSION_COOKIE,
  type SessionRequest,
  type SessionUser,
} from "./sessions.ts";
export {
  addUser,
  type AddUser,
  changeOwnPassword,
  changeOwnPin,
  changeUser,
  type ChangeUser,
  clearUserTwoFactor,
  createUser,
  deactivateUser,
  listUsers,
  type NewUser,
  reactivateUser,
  setUserPassword,
  setUserPin,
  userAccess,
  type UserAccess,
} from "./users.ts";
