// Identity: accounts, the sign-in identities, sessions and devices that
// reach them, invites, blocks and each device's KeyPackages (decisions 0014,
// 0019, 0024, 0029, 0033, 0061). The tables it owns are written only here.

export {
  activeDevices,
  activeDevicesOf,
  assistantAccount,
  clearPushToken,
  type Device,
  dropAccount,
  dropDeadPushToken,
  makeAssistant,
  me,
  orphans,
  type PushTarget,
  pushTarget,
  registerDevice,
  revokeAllDevices,
  revokeDevice,
  setPhotoVersion,
  setPushToken,
} from "./accounts.ts";
export {
  block,
  blockedByAny,
  blockedEither,
  blockersAmong,
  blockList,
  UNBLOCKED,
  unblock,
} from "./blocks.ts";
export { inviteRoutes } from "./invites.ts";
export { type ApprovedLink, approvedLink, linkedDeviceRoutes } from "./linked-devices.ts";
export {
  expireLinkedDevices,
  LINKED_IDLE_MS,
  linkedDeviceOfSession,
} from "./linked-device-lifecycle.ts";
export { type Caller, linkIdentity } from "./linking.ts";
export { sessionRoutes } from "./session-routes.ts";
export { claim, expireKeyPackages, ownsLeaf, upload } from "./key-packages.ts";
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
export { authorized, type Person, signInConfig, unavailable } from "./providers.ts";
export { webSignInRoutes } from "./web-sign-in.ts";
