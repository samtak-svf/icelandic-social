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
    kind: z.enum([
      "comment",
      "reply",
      "reaction",
      "join_approved",
      "moderated",
      "friend_request",
      "friend_accepted",
      "reports_waiting",
    ]),
    // Who did it, the newest if several; null once deleted.
    actor: z.union([Author, z.null()]),
    actors: z.array(Author).openapi({
      description:
        "The newest three distinct accounts that caused the notification, newest first (decision 0103)",
    }),
    actorCount: z.int().openapi({
      description: "How many distinct accounts caused it; `actor` and `actors` are among them",
    }),
    communityId: OpaqueId.nullable().openapi({
      description: "None for a notification about the account itself (decision 0114)",
    }),
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
    snippet: z.string().nullable().openapi({
      description:
        "For `comment` and `reply` the newest comment's text, for `reaction` the post's: whitespace collapsed, at most 100 characters, cut with an ellipsis. Read with the page, null when the caller may no longer read it (decision 0105)",
    }),
    announce: z.boolean().openapi({
      description:
        "True when the row is unread and its effective level is `push` now: a client may announce it (decision 0106)",
    }),
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

const Level = z.enum(["off", "in_app", "push"]).openapi("NotificationLevel", {
  description:
    "`off` writes nothing, `in_app` writes the notification and sends no push, `push` also pushes (decision 0106)",
});
const KIND_LEVELS = {
  comment: Level,
  reply: Level,
  reaction: Level,
  join_approved: Level,
  moderated: Level,
  friend_request: Level,
  friend_accepted: Level,
};

const NotificationSettings = z
  .object({
    kinds: z
      .object(KIND_LEVELS)
      .openapi({ description: "A level for each kind; `push` if never set" }),
    communities: z
      .array(z.object({ communityId: OpaqueId, level: Level }))
      .openapi({ description: "The communities with a level set; the others are `push`" }),
  })
  .openapi("NotificationSettings");

export const notificationSettingsRoute = createRoute({
  method: "get",
  path: "/v1/notification-settings",
  operationId: "notificationSettings",
  tags,
  summary: "How loudly the caller is told, for each kind and community (decision 0106)",
  description:
    "The effective level of a notification is the lower of its kind's and its community's. `moderated` is never below `in_app`.",
  security: ACCOUNT,
  responses: {
    200: {
      description: "The settings",
      content: { "application/json": { schema: NotificationSettings } },
    },
    ...AUTHED,
  },
});

export const putNotificationSettingsRoute = createRoute({
  method: "put",
  path: "/v1/notification-settings",
  operationId: "putNotificationSettings",
  tags,
  summary: "Set the level of some kinds; the kinds not given are left as they were",
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              kinds: z
                .object(KIND_LEVELS)
                .partial()
                .refine((k) => k.moderated !== "off", {
                  message: "`moderated` cannot be off",
                }),
            })
            .openapi({ description: "`moderated` cannot be `off` (400)" }),
        },
      },
    },
  },
  responses: { 204: { description: "Stored" }, ...INVALID, ...AUTHED },
});

export const communityLevelRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/notification-level",
  operationId: "setCommunityNotificationLevel",
  tags,
  summary: "Set how loudly the caller is told of a community (decision 0106)",
  security: ACCOUNT,
  request: {
    params: z.object({ communityId: OpaqueId }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ level: Level }) } },
    },
  },
  responses: {
    204: { description: "Stored" },
    404: errorResponse("not_found: no such community the caller can see"),
    ...INVALID,
    ...AUTHED,
  },
});
