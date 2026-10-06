import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  base64,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  OpaqueId,
  RATE_LIMITED,
} from "./common.ts";

// Accounts and devices (decision 0014).

const RegisterDevice = z
  .object({
    kenniCode: z.string().min(1).max(2048).openapi({ description: "The Kenni authorization code" }),
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
    platform: z.enum(["android", "ios"]),
    deviceKey: base64(32).openapi({
      description: "The device's Ed25519 public key, also its MLS credential key",
    }),
    inviteToken: z.string().min(1).max(256).optional().openapi({
      description: "Required when the Kenni sign-in has no account yet (decision 0009)",
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
  summary: "Sign in with Kenni and register this device",
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
      "sign_in_failed: Kenni refused the code or its ID token did not verify; invite_required: no account for this person and no live invite",
    ),
    409: errorResponse("device_key_taken: another device registered this device key"),
    ...RATE_LIMITED,
    503: errorResponse("kenni_unavailable: Kenni could not be reached"),
  },
});

const SignInConfig = z
  .object({
    authorizationEndpoint: z
      .string()
      .openapi({ example: "https://idp.kenni.is/innskraning.is/oidc/auth" }),
    clientId: z.string().openapi({ example: "@innskraning.is/samtak-spjall" }),
    redirectUri: z.string().openapi({ example: "is.samtak.spjall:/kenni" }),
    scope: z.string().openapi({ example: "openid national_id audkenni_name" }),
  })
  .openapi("SignInConfig");

export const signInConfigRoute = createRoute({
  method: "get",
  path: "/v1/sign-in",
  operationId: "getSignInConfig",
  tags: ["devices"],
  summary: "Where the app sends a person to sign in with Kenni (decision 0019)",
  responses: {
    200: {
      description: "The authorization request's parts; the app adds PKCE, state and nonce",
      content: { "application/json": { schema: SignInConfig } },
    },
    ...RATE_LIMITED,
    503: errorResponse("kenni_unavailable: Kenni could not be reached"),
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
    name: z.string().nullable().openapi({ description: "The registry name, if Kenni gave one" }),
    verified: z.boolean().openapi({ description: "Kenni vouched for the name (decision 0009)" }),
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
