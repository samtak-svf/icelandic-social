import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, base64, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Accounts and devices (decision 0014).

const RegisterDevice = z
  .object({
    kenniCode: z.string().min(1).max(2048).openapi({ description: "The Kenni authorization code" }),
    codeVerifier: z
      .string()
      .regex(/^[A-Za-z0-9._~-]{43,128}$/)
      .openapi({ description: "The PKCE verifier for that code" }),
    redirectUri: z.string().min(1).max(512),
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
    403: errorResponse("No account for this person and no valid invite token"),
    501: AUTHED[501],
  },
});

export const revokeDeviceRoute = createRoute({
  method: "delete",
  path: "/v1/devices/{deviceId}",
  operationId: "revokeDevice",
  tags: ["devices"],
  summary: "Revoke a device of this account and its token",
  security: DEVICE_TOKEN,
  request: { params: z.object({ deviceId: OpaqueId }) },
  responses: { 204: { description: "The device is revoked" }, ...INVALID, ...AUTHED },
});

export const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/v1/me",
  operationId: "deleteAccount",
  tags: ["devices"],
  summary: "Delete this account, its devices, inbox and media (decision 0014)",
  security: DEVICE_TOKEN,
  responses: { 204: { description: "The account is deleted" }, ...AUTHED },
});
