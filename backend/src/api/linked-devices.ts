import { createRoute, z } from "@hono/zod-openapi";
import {
  ACCOUNT,
  AUTHED,
  base64,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  OpaqueId,
  SESSION_ONLY,
} from "./common.ts";

// Enrolling a linked non-phone device from a browser session (decision 0064, #299).

const CreateDeviceLinkRequest = z
  .object({
    deviceKey: base64(32).openapi({
      description: "The linked browser's Ed25519 public key (decision 0064)",
    }),
    historyKey: base64(32).openapi({
      description:
        "The one-time X25519 public key for the optional history transfer (decision 0064)",
    }),
  })
  .openapi("CreateDeviceLinkRequest");

const CreatedDeviceLinkRequest = z
  .object({
    linkId: OpaqueId,
    expiresAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
  })
  .openapi("CreatedDeviceLinkRequest");

export const createDeviceLinkRoute = createRoute({
  method: "post",
  path: "/v1/devices/link-requests",
  operationId: "createDeviceLinkRequest",
  tags: ["devices"],
  summary: "Start linking this browser session as an MLS device (decision 0064)",
  security: SESSION_ONLY,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateDeviceLinkRequest } },
    },
  },
  responses: {
    200: {
      description: "The pending link request; show its id and keys as a QR code for a phone",
      content: { "application/json": { schema: CreatedDeviceLinkRequest } },
    },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("no_phone_device: this account has no active phone to approve linking"),
    409: errorResponse(
      "device_key_taken: another device holds this key; session_already_linked: this session already has an active linked device",
    ),
  },
});

const DeviceLinkRequestInfo = z
  .object({
    linkId: OpaqueId,
    sessionId: OpaqueId,
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceKey: base64(32),
    historyKey: base64(32),
    expiresAt: z.int(),
    approved: z.boolean(),
  })
  .openapi("DeviceLinkRequestInfo");

export const getDeviceLinkRoute = createRoute({
  method: "get",
  path: "/v1/devices/link-requests/{linkId}",
  operationId: "getDeviceLinkRequest",
  tags: ["devices"],
  summary: "Inspect a pending device link request of this account (decision 0064)",
  security: ACCOUNT,
  request: { params: z.object({ linkId: OpaqueId }) },
  responses: {
    200: {
      description: "The link request",
      content: { "application/json": { schema: DeviceLinkRequestInfo } },
    },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such pending link request on this account"),
  },
});

const ApproveDeviceLinkRequest = z
  .object({
    signature: base64(64).openapi({
      description:
        "64-byte Ed25519 signature by this phone's device key over the UTF-8 bytes `spjall device link v1` and a zero byte, then the UTF-8 linkId, then the new device's 32-byte deviceKey (decision 0077)",
    }),
    history: z.enum(["none", "sent"]).optional().openapi({
      description:
        "Whether the phone sends a history (decision 0081); absent means sent, as 0.37 apps send it",
    }),
  })
  .openapi("ApproveDeviceLinkRequest");

export const approveDeviceLinkRoute = createRoute({
  method: "post",
  path: "/v1/devices/link-requests/{linkId}/approve",
  operationId: "approveDeviceLinkRequest",
  tags: ["devices"],
  summary:
    "Approve a pending device link request from an active phone of this account (decision 0064)",
  security: DEVICE_TOKEN,
  request: {
    params: z.object({ linkId: OpaqueId }),
    body: {
      required: true,
      content: { "application/json": { schema: ApproveDeviceLinkRequest } },
    },
  },
  responses: {
    204: { description: "The link request is approved" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "phone_required: only an active phone may approve a linked device; invalid_signature: the signature did not verify under this phone's key",
    ),
    404: errorResponse("not_found: no such pending link request on this account"),
    409: errorResponse("already_approved: a phone has already approved this request"),
  },
});

const LinkedDeviceEnrolled = z
  .object({
    accountId: OpaqueId,
    deviceId: OpaqueId,
    sessionId: OpaqueId,
    token: z.string().openapi({ description: "The device token, shown once; send it as Bearer" }),
    storeKeyShare: base64(32).openapi({
      description: "The server's 32-byte half of the browser's two-part store key (decision 0064)",
    }),
    historyExpected: z.boolean().openapi({
      description:
        "Whether the approving phone sends a history, so the browser waits for one only then (decision 0081)",
    }),
  })
  .openapi("LinkedDeviceEnrolled");

export const completeDeviceLinkRoute = createRoute({
  method: "post",
  path: "/v1/devices/link-requests/{linkId}/complete",
  operationId: "completeDeviceLinkRequest",
  tags: ["devices"],
  summary: "Finish enrolling a linked browser device after phone approval (decision 0064)",
  security: SESSION_ONLY,
  request: { params: z.object({ linkId: OpaqueId }) },
  responses: {
    200: {
      description: "The linked device is enrolled",
      content: { "application/json": { schema: LinkedDeviceEnrolled } },
    },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such pending link request for this session"),
    409: errorResponse(
      "not_approved: no active phone has approved this request yet; device_key_taken: another device registered this key",
    ),
  },
});

const LinkedStoreKey = z
  .object({
    deviceId: OpaqueId,
    storeKeyShare: base64(32),
  })
  .openapi("LinkedStoreKey");

export const getLinkedStoreKeyRoute = createRoute({
  method: "get",
  path: "/v1/devices/me/store-key",
  operationId: "getLinkedStoreKey",
  tags: ["devices"],
  summary:
    "Fetch the server's half of the browser store key for this session's linked device (decision 0064)",
  security: SESSION_ONLY,
  responses: {
    200: {
      description: "The server's store-key share for this session's linked device",
      content: { "application/json": { schema: LinkedStoreKey } },
    },
    ...AUTHED,
    404: errorResponse("not_found: this session has no active linked device"),
  },
});
