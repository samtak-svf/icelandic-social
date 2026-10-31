// Identity: accounts, the sign-in identities, sessions and devices that
// reach them, invites, blocks and each device's KeyPackages (decisions 0014,
// 0019, 0024, 0029, 0033, 0061). The tables it owns are written only here.

export {
  accountProfile,
  activeDevices,
  activeDevicesOf,
  type Device,
  dropAccount,
  dropDeadPushToken,
  orphans,
  type PushTarget,
  pushTarget,
  revokeAllDevices,
  setBio,
  setPhotoVersion,
} from "./accounts.ts";
export {
  notSuspended,
  setSuspension,
  suspendedAmong,
  suspension,
  type Suspension,
} from "./suspension.ts";
export {
  accountExists,
  blockedEither,
  blocking,
  blockersAmong,
  blockList,
  UNBLOCKED,
  unblock,
} from "./blocks.ts";
export { inviteRoutes } from "./invites.ts";
export { identityRoutes } from "./routes.ts";
export { type ApprovedLink, approvedLink, linkedDeviceRoutes } from "./linked-devices.ts";
export {
  expireLinkedDevices,
  LINKED_IDLE_MS,
  linkedDeviceOfSession,
} from "./linked-device-lifecycle.ts";
export { type Caller, linkIdentity } from "./linking.ts";
export { sessionRoutes } from "./session-routes.ts";
export { expireKeyPackages, ownsLeaf } from "./key-packages.ts";
export { linkHost } from "./link.ts";
export {
  deviceForToken,
  expireSessions,
  type Session,
  SESSION_COOKIE,
  SESSION_SECRET,
  sessionCookie,
  sessionForSecret,
  wipeBrowserStorage,
} from "./sessions.ts";
export { type Person } from "./providers.ts";
export { webSignInRoutes } from "./web-sign-in.ts";
