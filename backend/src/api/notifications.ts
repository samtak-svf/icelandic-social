import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";
import { Emoji } from "./emoji.ts";
import { Author } from "./social.ts";

// Notifications (decisions 0063, 0067): something addressed to the caller, a
// comment or a reaction on its post, an approved join request, a moderator's
// action on its content. A notification carries ids, never the content; the
// client reads the thing itself, through the same access checks.

const Notification = z
  .object({
    notificationId: z.string(),
    kind: z.enum(["comment", "reply", "reaction", "join_approved", "moderated"]),
    // Who did it, the newest if several; null once deleted.
    actor: z.union([Author, z.null()]),
    actors: z.array(Author).openapi({
      description:
        "The newest three distinct accounts that caused the notification, newest first (decision 0103)",
    }),
    actorCount: z.int().openapi({
      description: "How many distinct accounts caused it; `actor` and `actors` are among them",
    }),
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
    unseen: z.int().openapi({
      description: "How many unread notifications are newer than `seenAt` (decision 0104)",
    }),
    seenAt: z.int().nullable().openapi({
      description: "Unix milliseconds the caller has seen its notifications up to; null if never",
    }),
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

const ReadBody = z
  .object({
    upTo: z.int().optional().openapi({ description: "Every notification created at or before it" }),
    notificationId: z.string().optional().openapi({ description: "One notification, with `read`" }),
    read: z
      .boolean()
      .optional()
      .openapi({ description: "With `notificationId`: true marks it read, false unread again" }),
  })
  .refine(
    (b) =>
      (b.upTo !== undefined && b.notificationId === undefined && b.read === undefined) ||
      (b.upTo === undefined && b.notificationId !== undefined && b.read !== undefined),
    { message: "Give `upTo`, or `notificationId` with `read`, and nothing else" },
  );

export const readNotificationsRoute = createRoute({
  method: "post",
  path: "/v1/notifications/read",
  operationId: "readNotifications",
  tags,
  summary: "Mark notifications read: all up to a time, or one (decision 0104)",
  security: ACCOUNT,
  request: { body: { required: true, content: { "application/json": { schema: ReadBody } } } },
  responses: {
    204: { description: "Marked" },
    404: errorResponse("not_found: no such notification of the caller's"),
    ...INVALID,
    ...AUTHED,
  },
});

export const seenNotificationsRoute = createRoute({
  method: "post",
  path: "/v1/notifications/seen",
  operationId: "seenNotifications",
  tags,
  summary: "Record that the caller has seen its notifications, up to a time (decision 0104)",
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            upTo: z.int().openapi({ description: "Unix milliseconds; seen never moves back" }),
          }),
        },
      },
    },
  },
  responses: { 204: { description: "Recorded" }, ...INVALID, ...AUTHED },
});

export const deleteNotificationRoute = createRoute({
  method: "delete",
  path: "/v1/notifications/{notificationId}",
  operationId: "deleteNotification",
  tags,
  summary: "Delete one of the caller's notifications (decision 0104)",
  security: ACCOUNT,
  request: { params: z.object({ notificationId: z.string().min(1).max(200) }) },
  responses: {
    204: { description: "Deleted" },
    404: errorResponse("not_found: no such notification of the caller's"),
    ...INVALID,
    ...AUTHED,
  },
});
