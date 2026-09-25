export type { AccessContext, AccessDependencies } from "./dependencies.ts";
export {
  authenticateDevice,
  DEVICE_PREFIXES,
  type Device,
  issueRegistrationCode,
  type IssuedRegistrationCode,
  type NewDevice,
  REGISTRATION_CODE_LIFETIME_MS,
  registerDevice,
  type RegisteredDevice,
} from "./devices.ts";
export { type LoggedIn, logIn, type LoginInput } from "./login.ts";
export { accessModule } from "./manifest.ts";
export { hashPassword } from "./passwords.ts";
export {
  createRole,
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
export { createUser, type NewUser, userAccess, type UserAccess } from "./users.ts";
