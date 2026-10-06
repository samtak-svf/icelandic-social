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

// KeyPackages, kept in D1 and consumed once (decisions 0002, 0017).

/** An MLS KeyPackage message whose leaf credential is `{accountId}/{deviceId}`. */
const KeyPackage = base64(16 * 1024);

const UploadKeyPackages = z
  .object({
    keyPackages: z.array(KeyPackage).max(100),
    lastResort: KeyPackage.optional().openapi({
      description: "Replaces this device's last-resort package; never consumed",
    }),
  })
  .openapi("UploadKeyPackages");

const KeyPackageStock = z
  .object({
    available: z.int().min(0).openapi({ description: "This device's unclaimed packages" }),
  })
  .openapi("KeyPackageStock");

const ClaimedKeyPackages = z
  .object({
    keyPackages: z.array(z.object({ deviceId: OpaqueId, keyPackage: KeyPackage })).openapi({
      description: "One per active device of the account, except the caller's",
    }),
  })
  .openapi("ClaimedKeyPackages");

export const uploadKeyPackagesRoute = createRoute({
  method: "post",
  path: "/v1/key-packages",
  operationId: "uploadKeyPackages",
  tags: ["key-packages"],
  summary: "Add KeyPackages for this device",
  security: DEVICE_TOKEN,
  request: {
    body: { required: true, content: { "application/json": { schema: UploadKeyPackages } } },
  },
  responses: {
    200: {
      description: "Stored",
      content: { "application/json": { schema: KeyPackageStock } },
    },
    400: errorResponse(
      "invalid_request: not a KeyPackage naming this device and its key, or more than 100 held",
    ),
    ...AUTHED,
  },
});

export const claimKeyPackagesRoute = createRoute({
  method: "post",
  path: "/v1/accounts/{accountId}/key-packages",
  operationId: "claimKeyPackages",
  tags: ["key-packages"],
  summary: "Take one KeyPackage per device of an account, to add it to a group",
  security: DEVICE_TOKEN,
  request: { params: z.object({ accountId: OpaqueId }) },
  responses: {
    200: {
      description: "Claimed",
      content: { "application/json": { schema: ClaimedKeyPackages } },
    },
    ...INVALID,
    404: errorResponse("not_found: no such account, or it has no devices"),
    ...AUTHED,
    ...RATE_LIMITED,
  },
});
