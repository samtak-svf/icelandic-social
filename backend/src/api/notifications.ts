import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, INVALID, OpaqueId } from "./common.ts";
import { Emoji } from "./emoji.ts";
import { Author } from "./social.ts";

// Notifications (decisions 0063, 0067): something addressed to the caller, a
// comment or a reaction on its post, an approved join request, a moderator's
// action on its content. A notification carries ids, never the content; the
// client reads the thing itself, through the same access checks.

const Notification = z
  .object({
    notificationId: z.string(),
    kind: z.enum(["comment", "reaction", "join_approved", "moderated"]),
    // Who did it; null once deleted.
    actor: z.union([Author, z.null()]),
    communityId: OpaqueId,
    postId: OpaqueId.nullable(),
    commentId: z.string().nullable(),
    action: z.string().nullable().openapi({
      description: "For `moderated`, the moderator's action (`hide_post`, `remove_comment`, ...)",
    }),
    emoji: Emoji.nullable().openapi({
      description: "For `reaction`, the emoji the account first reacted with (decision 0100)",
    }),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
    read: z.boolean(),
  })
  .openapi("Notification");

const NotificationPage = z
  .object({
    notifications: z.array(Notification),
    unread: z.int().openapi({ description: "How many of the caller's notifications are unread" }),
    next: z.string().nullable().openapi({ description: "The cursor of the next, older page" }),
  })
  .openapi("NotificationPage");

const tags = ["notifications"];

export const notificationsRoute = createRoute({
  method: "get",
  path: "/v1/notifications",
  operationId: "notifications",
  tags,
  summary: "The caller's notifications, newest first",
  security: ACCOUNT,
  request: {
    query: z.object({
      before: z
        .string()
        .regex(/^\d{1,16}$/)
        .optional()
        .openapi({ description: "The `next` of the page before" }),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: {
    200: {
      description: "The notifications",
      content: { "application/json": { schema: NotificationPage } },
    },
    ...INVALID,
    ...AUTHED,
  },
});

export const readNotificationsRoute = createRoute({
  method: "post",
  path: "/v1/notifications/read",
  operationId: "readNotifications",
  tags,
  summary: "Mark the caller's notifications read, up to a time",
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            upTo: z.int().openapi({ description: "Every notification created at or before it" }),
          }),
        },
      },
    },
  },
  responses: { 204: { description: "Marked" }, ...INVALID, ...AUTHED },
});
