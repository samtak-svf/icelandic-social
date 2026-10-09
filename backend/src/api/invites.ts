import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  OpaqueId,
  RATE_LIMITED,
  TOO_OLD,
} from "./common.ts";

// Invites (decisions 0009, 0019): one personal link per account, and what a
// link says about who sent it, before sign-in.

/** An invite token as it appears in a link: 32 random bytes, base64url. */
const InviteToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/)
  .openapi({ example: "q1w2e3r4t5y6u7i8o9p0aAsSdDfFgGhHjJkKlLzZxXc" });

const NewInvite = z
  .object({
    token: InviteToken,
    link: z.string().openapi({
      description: "The link to share; shown once, since the server keeps only its hash",
      example: "https://spjall.samtak.is/l/q1w2e3r4t5y6u7i8o9p0aAsSdDfFgGhHjJkKlLzZxXc",
    }),
  })
  .openapi("NewInvite");

const ResolvedInvite = z
  .object({
    inviter: z
      .object({
        accountId: OpaqueId.openapi({
          description: "The inviter, to open a 1:1 with (decision 0022)",
        }),
        name: z
          .string()
          .nullable()
          .openapi({ description: "The registry name, if Kenni gave one" }),
        verified: z.boolean(),
      })
      .nullable()
      .openapi({ description: "Null for an invite the operator made" }),
  })
  .openapi("ResolvedInvite");

export const rotateInviteRoute = createRoute({
  method: "post",
  path: "/v1/me/invite",
  operationId: "rotateInvite",
  tags: ["invites"],
  summary: "Make this account's invite link, revoking the one before",
  security: DEVICE_TOKEN,
  responses: {
    200: {
      description: "The new link; the old one no longer lets anyone in",
      content: { "application/json": { schema: NewInvite } },
    },
    ...AUTHED,
  },
});

export const revokeInviteRoute = createRoute({
  method: "delete",
  path: "/v1/me/invite",
  operationId: "revokeInvite",
  tags: ["invites"],
  summary: "Revoke this account's invite link and leave it without one",
  security: DEVICE_TOKEN,
  responses: { 204: { description: "The account has no live invite" }, ...AUTHED },
});

export const resolveInviteRoute = createRoute({
  method: "get",
  path: "/v1/invites/{token}",
  operationId: "resolveInvite",
  tags: ["invites"],
  summary: "Who sent an invite link; needs no device token, the token is the capability",
  request: { params: z.object({ token: InviteToken }) },
  responses: {
    200: {
      description: "The invite is live",
      content: { "application/json": { schema: ResolvedInvite } },
    },
    ...INVALID,
    404: errorResponse("not_found: no live invite with this token"),
    ...TOO_OLD,
    ...RATE_LIMITED,
  },
});
