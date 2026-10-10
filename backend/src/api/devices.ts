import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  TOO_OLD,
  base64,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  OpaqueId,
  PhotoVersion,
  RATE_LIMITED,
} from "./common.ts";

// Accounts and devices (decision 0014).

const UNAVAILABLE = errorResponse(
  "kenni_unavailable: Kenni could not be reached; google_unavailable: Google could not be reached or is not configured",
);

/** The ways to sign in (decision 0033). */
const Provider = z.enum(["google", "kenni"]).openapi("IdentityProviderName");

/** What a browser sign-in hands back: the code and the PKCE and nonce that bind it. */
const authorization = {
  codeVerifier: z
    .string()
    .regex(/^[A-Za-z0-9._~-]{43,128}$/)
    .openapi({ description: "The PKCE verifier for that code" }),
  redirectUri: z.string().min(1).max(512).openapi({
    description: "The redirect the code was issued for: SignInConfig.redirectUri",
  }),
  nonce: z
    .string()
    .regex(/^[A-Za-z0-9_-]{22,128}$/)
    .openapi({ description: "The nonce the app put in the authorization request" }),
};

const Code = z.string().min(1).max(2048);

const RegisterDevice = z
  .object({
    provider: Provider.optional().openapi({
      description: "Who issued the code; kenni when left out (decision 0033)",
    }),
    code: Code.optional().openapi({
      description: "The authorization code; this or kenniCode is required",
    }),
    kenniCode: Code.optional().openapi({
      description: "The Kenni authorization code, as clients before 0.3.0 send it",
      deprecated: true,
    }),
    ...authorization,
    platform: z.enum(["android", "ios"]),
    deviceKey: base64(32).openapi({
      description: "The device's Ed25519 public key, also its MLS credential key",
    }),
    inviteToken: z.string().min(1).max(256).optional().openapi({
      description:
        "The invite link that brought this person, recorded on a new account (decision 0033)",
    }),
  })
  .openapi("RegisterDevice");

const RegisteredDevice = z
  .object({
    accountId: OpaqueId,
    deviceId: OpaqueId,
    token: z.string().openapi({ description: "The device token, shown once; send it as Bearer" }),
  })
  .openapi("RegisteredDevice");

export const registerDeviceRoute = createRoute({
  method: "post",
  path: "/v1/devices",
  operationId: "registerDevice",
  tags: ["devices"],
  summary: "Sign in with Google or Kenni and register this device",
  description:
    "A sign-in whose identity no account holds makes a new account; no invite is needed (decision 0033).",
  request: {
    body: { required: true, content: { "application/json": { schema: RegisterDevice } } },
  },
  responses: {
    200: {
      description: "The device is registered",
      content: { "application/json": { schema: RegisteredDevice } },
    },
    ...INVALID,
    403: errorResponse(
      "sign_in_failed: the provider refused the code, its ID token did not verify, or Google has not verified the address",
    ),
    409: errorResponse("device_key_taken: another device registered this device key"),
    ...TOO_OLD,
    ...RATE_LIMITED,
    503: UNAVAILABLE,
  },
});

const SignInConfig = z
  .object({
    authorizationEndpoint: z
      .string()
      .openapi({ example: "https://idp.kenni.is/innskraning.is/oidc/auth" }),
    clientId: z.string().openapi({ example: "@innskraning.is/spjall" }),
    redirectUri: z.string().openapi({ example: "is.samtak.spjall:/kenni" }),
    scope: z.string().openapi({ example: "openid national_id audkenni_name" }),
  })
  .openapi("SignInConfig");

export const signInConfigRoute = createRoute({
  method: "get",
  path: "/v1/sign-in",
  operationId: "getSignInConfig",
  tags: ["devices"],
  summary: "Where the app sends a person to sign in (decisions 0019, 0033)",
  request: {
    query: z.object({
      provider: Provider.optional().openapi({ description: "kenni when left out" }),
    }),
  },
  responses: {
    200: {
      description: "The authorization request's parts; the app adds PKCE, state and nonce",
      content: { "application/json": { schema: SignInConfig } },
    },
    ...INVALID,
    ...TOO_OLD,
    ...RATE_LIMITED,
    503: UNAVAILABLE,
  },
});

const LinkIdentity = z
  .object({
    provider: Provider,
    code: Code,
    ...authorization,
    merge: z.boolean().optional().openapi({
      description:
        "This client follows a move: a Kenni identity held by an account without Google joins this account into it, and the answer is 200 (decision 0035)",
    }),
  })
  .openapi("LinkIdentity");

const Linked = z
  .object({
    accountId: OpaqueId.openapi({
      description: "The account this device now belongs to: this one, or the one it joined",
    }),
  })
  .openapi("Linked");

export const linkIdentityRoute = createRoute({
  method: "post",
  path: "/v1/me/identities",
  operationId: "linkIdentity",
  tags: ["devices"],
  summary: "Link another way to sign in to this account (decision 0033)",
  description:
    "Linking Kenni marks the account verified and gives it the registry's name. Linking the identity this account already holds succeeds again. With merge, a Kenni identity held by an account without Google joins this account into that one: the Google identity, this device with its token, the posts, replies, reactions and blocks move, and this account is deleted (decision 0035).",
  security: DEVICE_TOKEN,
  request: {
    body: { required: true, content: { "application/json": { schema: LinkIdentity } } },
  },
  responses: {
    200: {
      description:
        "With merge: the account holds the identity, and this device belongs to accountId",
      content: { "application/json": { schema: Linked } },
    },
    204: { description: "Without merge: the account holds the identity" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("sign_in_failed: as registerDevice"),
    409: errorResponse(
      "identity_taken: another account holds this identity, and they cannot be joined; already_linked: this account holds another identity of this provider",
    ),
    503: UNAVAILABLE,
  },
});

export const revokeDeviceRoute = createRoute({
  method: "delete",
  path: "/v1/devices/{deviceId}",
  operationId: "revokeDevice",
  tags: ["devices"],
  summary: "Revoke a device of this account and its token",
  description:
    "The token fails at once, the device's KeyPackages are deleted, and its socket closes with 4401. A device may revoke itself; that is signing out (decision 0019).",
  security: DEVICE_TOKEN,
  request: { params: z.object({ deviceId: OpaqueId }) },
  responses: {
    204: { description: "The device is revoked" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: this account has no such active device"),
  },
});

const PushToken = z
  .object({
    token: z.string().min(1).max(4096).openapi({
      description: "The FCM registration token, or the APNs device token in hex",
    }),
    sandbox: z.boolean().optional().openapi({
      description: "An APNs token from a development build; ignored on Android",
    }),
  })
  .openapi("PushToken");

const pushParams = z.object({ deviceId: OpaqueId });
const NOT_THIS_DEVICE = {
  403: errorResponse("not_this_device: only a device may set or remove its own push token"),
};

export const setPushTokenRoute = createRoute({
  method: "put",
  path: "/v1/devices/{deviceId}/push",
  operationId: "setPushToken",
  tags: ["devices"],
  summary: "Register this device's push token (decision 0025)",
  description:
    "A token is one device's at a time: registering it takes it from any other device that had it.",
  security: DEVICE_TOKEN,
  request: {
    params: pushParams,
    body: { required: true, content: { "application/json": { schema: PushToken } } },
  },
  responses: {
    204: { description: "The token is registered" },
    ...INVALID,
    ...AUTHED,
    ...NOT_THIS_DEVICE,
  },
});

export const clearPushTokenRoute = createRoute({
  method: "delete",
  path: "/v1/devices/{deviceId}/push",
  operationId: "clearPushToken",
  tags: ["devices"],
  summary: "Remove this device's push token, so nothing is pushed to it",
  security: DEVICE_TOKEN,
  request: { params: pushParams },
  responses: {
    204: { description: "The device has no push token" },
    ...INVALID,
    ...AUTHED,
    ...NOT_THIS_DEVICE,
  },
});

export const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/v1/me",
  operationId: "deleteAccount",
  tags: ["devices"],
  summary: "Delete this account, its devices, inbox and media (decision 0014)",
  description:
    "Every token is revoked, each conversation drops the account from its roster, the inbox is deleted and the sockets close with 4401, then the account's rows go, with its invites (decision 0019).",
  security: DEVICE_TOKEN,
  responses: { 204: { description: "The account is deleted" }, ...AUTHED },
});

const Me = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable().openapi({
      description: "The registry name once Kenni is linked, else the name Google gave",
    }),
    verified: z.boolean().openapi({ description: "Kenni vouched for the name (decision 0009)" }),
    photo: PhotoVersion,
    devices: z.array(
      z.object({
        deviceId: OpaqueId,
        platform: z.enum(["android", "ios"]),
        createdAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
        current: z.boolean().openapi({ description: "The device that asked" }),
      }),
    ),
  })
  .openapi("Me");

export const getMeRoute = createRoute({
  method: "get",
  path: "/v1/me",
  operationId: "getMe",
  tags: ["devices"],
  summary: "This account: its name, its mark and its active devices",
  security: DEVICE_TOKEN,
  responses: {
    200: { description: "The account", content: { "application/json": { schema: Me } } },
    ...AUTHED,
  },
});
