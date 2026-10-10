import { z } from "@hono/zod-openapi";

// Shapes shared by the routes and the WebSocket frames (decisions 0014, 0015).

/** An id the server or a client made up; never personal data (decision 0008). */
export const OpaqueId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/)
  .openapi({ example: "c_9f3a1b" });

/**
 * Binary data as standard base64 text. A plain string with a pattern, not
 * `format: byte`, so both generated clients and tooling/ws-kotlin.mjs take it.
 */
export const base64 = (maxBytes: number) =>
  z
    .string()
    .min(1)
    .max(Math.ceil(maxBytes / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .openapi({ description: `Base64, at most ${maxBytes} bytes decoded` });

export const ApiError = z
  .object({
    error: z.string().openapi({
      description:
        "A stable code: unauthorized, invalid_request, group_mismatch, not_a_member, not_found, conversation_exists, epoch_conflict, upgrade_required, sign_in_failed, device_key_taken, kenni_unavailable, google_unavailable, identity_taken, already_linked, rate_limited, blocked, conflict, too_large, not_this_device, no_key_packages, client_too_old, claim_names_departed, not_author, internal_error",
      example: "unauthorized",
    }),
    requestId: z.string().openapi({
      description:
        "The request's id, also in the x-request-id header: opaque, for support to find the request by (decision 0037)",
      example: "8c1f2e3d4a5b6c7d-KEF",
    }),
    minVersion: z.string().optional().openapi({
      description: "With client_too_old: the lowest version this platform accepts (decision 0030)",
      example: "0.2.0",
    }),
  })
  .openapi("ApiError");

const error = (description: string) => ({
  description,
  content: { "application/json": { schema: ApiError } },
});

/** What every /v1 route answers a build below its platform's floor (decision 0030). */
export const TOO_OLD = {
  426: error(
    "client_too_old: Spjall-Client names a version below the floor; minVersion says which",
  ),
};

/** The answers every route that needs a device token can give. */
export const AUTHED = {
  401: error("No device token, or one that is not valid"),
  ...TOO_OLD,
};

export const INVALID = { 400: error("The request does not match the schema") };

/** The answer of a route with a rate limit: per address, or per account once signed in. */
export const RATE_LIMITED = {
  429: error("rate_limited: too many requests in the last minute; try again later"),
};

/** The answers of a route inside one conversation (decision 0017). */
export const MEMBER = {
  403: error("not_a_member: this account is not in the conversation"),
  404: error("not_found: no such conversation"),
};

/** A conversation id: its MLS group id as unpadded base64url (decision 0017). */
export const ConversationId = OpaqueId.openapi({
  description: "The MLS group id, unpadded base64url",
  example: "q1w2e3r4t5y6u7i8o9p0aA",
});

export const errorResponse = error;

/** The security requirement for a route that needs a device token (decision 0014). */
export const DEVICE_TOKEN = [{ deviceToken: [] }];
