import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";
import { Author } from "./social.ts";

// Moderation (decisions 0063, 0066): reports on a post, a comment, a community
// or an account; the queues of a community's moderators and of Samtak's
// platform moderators; what a moderator does; and the moderation log, which
// keeps every action and is never edited. A report is never shown with the
// account that made it.

/** The longest note on a report, and reason for an action, in characters. */
const MAX_NOTE = 500;

export const REPORT_KINDS = ["post", "comment", "community", "account"] as const;
export const REPORT_REASONS = ["unlawful", "harassment", "spam", "other"] as const;

/** What a moderator does, by the kind of thing it does it to. */
export const ACTIONS = {
  hide_post: "post",
  remove_post: "post",
  restore_post: "post",
  hide_comment: "comment",
  remove_comment: "comment",
  restore_comment: "comment",
  mute_member: "account",
  unmute_member: "account",
  remove_member: "account",
  ban_member: "account",
  unban_member: "account",
} as const;
export type Action = keyof typeof ACTIONS;

/** What the log records of a community's picture and cover (decision 0080). */
export const COMMUNITY_IMAGE_ACTIONS = [
  "set_community_picture",
  "remove_community_picture",
  "set_community_cover",
  "remove_community_cover",
] as const;

/** What the log records of the post pinned to the top of a community (decision 0080). */
export const COMMUNITY_PIN_ACTIONS = ["pin_post", "unpin_post"] as const;

/** What the log records of a poll a moderator closed (decision 0090). */
export const COMMUNITY_POLL_ACTIONS = ["close_poll"] as const;

/**
 * What the log records of anonymous posts (decision 0091): the owner's
 * switch and a moderator's reveal of an author. Neither names the author;
 * the reveal names who revealed.
 */
export const COMMUNITY_ANONYMOUS_ACTIONS = [
  "anonymous_posts_on",
  "anonymous_posts_off",
  "reveal_author",
] as const;

/** How a report was closed: the action taken on its target, none, or its community deleted. */
const DECISIONS = [
  ...(Object.keys(ACTIONS) as [Action, ...Action[]]),
  "dismissed",
  "community_deleted",
] as const;

/** Where the account a report reaches stands in the report's community now. */
export const TARGET_STANDINGS = [
  "owner",
  "moderator",
  "member",
  "muted",
  "banned",
  "not_member",
  "gone",
] as const;

/** What has become of the post or comment a report is about. */
export const TARGET_STATES = ["visible", "pending", "hidden", "removed", "gone"] as const;

const CreatedAt = z.int().openapi({ description: "Unix milliseconds" });
const Target = z
  .object({ kind: z.enum(REPORT_KINDS), id: OpaqueId })
  .openapi("ReportTarget", { description: "What a report or an action is about" });

const Report = z
  .object({
    reportId: OpaqueId,
    communityId: OpaqueId.nullable(),
    target: Target,
    // Who wrote the post or comment, or the account reported; null once deleted.
    targetAccount: z.union([Author, z.null()]),
    reason: z.enum(REPORT_REASONS),
    note: z.string(),
    state: z.enum(["open", "closed"]),
    createdAt: CreatedAt,
    closedAt: z.int().nullable(),
    // How it was closed, and the moderator who closed it; null while open (decision 0070).
    decision: z.enum(DECISIONS).nullable().openapi({
      description:
        "How it was closed: the action taken, `dismissed`, or `community_deleted`; null while open",
    }),
    resolution: z.string().nullable().openapi({
      description: "The reason the action gave, or the closing resolution; null while open",
    }),
    closedBy: z.union([Author, z.null()]).openapi({
      description:
        "Who closed it; null while open, when the community's deletion did, or once deleted",
    }),
    targetAnonymous: z.boolean().openapi({
      description:
        "The reported post is anonymous (decision 0091): `targetAccount` and `targetStanding` are null, and a moderator may reveal the author with POST /v1/posts/{postId}/reveal",
    }),
    targetStanding: z.enum(TARGET_STANDINGS).nullable().openapi({
      description:
        "Where the account reported, or whose content was, stands in the community now: `gone` once the account is deleted; null for a community, or an account reported to Samtak",
    }),
    targetState: z.enum(TARGET_STATES).nullable().openapi({
      description: "What the reported post or comment is now; null for a community or an account",
    }),
    targetMedia: z.array(OpaqueId).openapi({
      description:
        "The media id of the reported comment's image, to read through `GET /v1/posts/{postId}/media/{mediaId}`; empty for anything else (decision 0082)",
    }),
  })
  .openapi("Report", { description: "A report, without the account that made it" });

const ReportPage = z
  .object({
    reports: z.array(Report),
    next: z.string().nullable().openapi({ description: "The cursor of the next page" }),
  })
  .openapi("ReportPage");

const LogEntry = z
  .object({
    entryId: z.int(),
    communityId: OpaqueId.nullable(),
    // null once the actor's account is deleted.
    actor: z.union([Author, z.null()]),
    asPlatform: z.boolean().openapi({ description: "Done as one of Samtak's platform moderators" }),
    action: z.enum([
      ...(Object.keys(ACTIONS) as [Action, ...Action[]]),
      "close_report",
      "delete_community",
      "restore_community",
      ...COMMUNITY_IMAGE_ACTIONS,
      ...COMMUNITY_PIN_ACTIONS,
      ...COMMUNITY_POLL_ACTIONS,
      ...COMMUNITY_ANONYMOUS_ACTIONS,
    ]),
    target: z.object({ kind: z.enum([...REPORT_KINDS, "report"]), id: OpaqueId }),
    targetAccount: z.union([Author, z.null()]),
    reason: z.string(),
    createdAt: CreatedAt,
  })
  .openapi("ModerationLogEntry");

const LogPage = z
  .object({
    entries: z.array(LogEntry),
    next: z.string().nullable().openapi({ description: "The cursor of the next, older page" }),
  })
  .openapi("ModerationLogPage");

const json = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const community = z.object({ communityId: OpaqueId });
const queue = z.object({
  state: z.enum(["open", "closed"]).default("open"),
  after: z
    .string()
    .regex(/^\d{1,16}-[A-Za-z0-9_-]{1,128}$/)
    .optional()
    .openapi({ description: "The `next` of the page before" }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const log = z.object({
  before: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional()
    .openapi({ description: "The `next` of the page before" }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const MODERATORS = { 403: errorResponse("not_permitted: only the community's moderators") };
const PLATFORM = { 403: errorResponse("not_permitted: only Samtak's platform moderators") };
const NO_COMMUNITY = { 404: errorResponse("not_found: no such community the caller can see") };
const tags = ["moderation"];

export const reportRoute = createRoute({
  method: "post",
  path: "/v1/reports",
  operationId: "report",
  tags,
  summary: "Report a post, a comment, a community or an account",
  description:
    "A report on a post or a comment goes to the community's moderators, or with `toPlatform` to Samtak's; one that says the content is unlawful, or is on a community or an account, always goes to Samtak's. The caller reports only what it can see, and a thing once while its report is open; a second report answers the same.",
  security: ACCOUNT,
  request: {
    body: body(
      z.object({
        target: Target,
        reason: z.enum(REPORT_REASONS),
        note: z.string().trim().max(MAX_NOTE).default(""),
        toPlatform: z.boolean().default(false),
      }),
    ),
  },
  responses: {
    204: { description: "Reported" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: nothing the caller can see by that reference"),
  },
});

export const communityReportsRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/reports",
  operationId: "communityReports",
  tags,
  summary: "The community's report queue, oldest first",
  security: ACCOUNT,
  request: { params: community, query: queue },
  responses: {
    200: json("The reports", ReportPage),
    ...INVALID,
    ...AUTHED,
    ...MODERATORS,
    ...NO_COMMUNITY,
  },
});

export const platformReportsRoute = createRoute({
  method: "get",
  path: "/v1/moderation/reports",
  operationId: "platformReports",
  tags,
  summary: "Samtak's report queue, oldest first",
  security: ACCOUNT,
  request: { query: queue },
  responses: { 200: json("The reports", ReportPage), ...INVALID, ...AUTHED, ...PLATFORM },
});

export const closeReportRoute = createRoute({
  method: "post",
  path: "/v1/reports/{reportId}/close",
  operationId: "closeReport",
  tags,
  summary: "Close a report, with what was done about it",
  description:
    "The community's moderators close a report in its queue, Samtak's platform moderators any. Closing is logged.",
  security: ACCOUNT,
  request: {
    params: z.object({ reportId: OpaqueId }),
    body: body(z.object({ resolution: z.string().trim().min(1).max(MAX_NOTE) })),
  },
  responses: {
    204: { description: "Closed" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_permitted: the report is in a queue the caller does not moderate"),
    404: errorResponse("not_found: no such open report"),
  },
});

export const moderateRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/actions",
  operationId: "moderate",
  tags,
  summary: "Act as a moderator on a post, a comment or a member",
  description:
    "A community's moderators, its owner and Samtak's platform moderators act; each only on what an account of a lower rank wrote, or on such an account (member, moderator, owner, platform moderator). Every action is logged with its reason. A hidden post or comment is shown only to moderators; a removed one too, until its text is deleted 90 days after the removal. A muted member reads but does not post, comment or react until `until`; a removed one may join again; a banned one may not, and reads nothing. With `reportId`, the report is closed by the same action.",
  security: ACCOUNT,
  request: {
    params: community,
    body: body(
      z.object({
        action: z.enum(Object.keys(ACTIONS) as [Action, ...Action[]]),
        targetId: OpaqueId.openapi({
          description: "The post's, the comment's or the account's id",
        }),
        reason: z.string().trim().min(1).max(MAX_NOTE),
        until: z.int().optional().openapi({
          description:
            "With mute_member, and only with it: when the mute ends, in Unix milliseconds",
        }),
        reportId: OpaqueId.optional(),
      }),
    ),
  },
  responses: {
    204: { description: "Done" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "not_permitted: the caller does not moderate the community, or the target's rank is not lower",
    ),
    404: errorResponse("not_found: no such community, target or open report there"),
  },
});

export const communityLogRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/moderation-log",
  operationId: "communityModerationLog",
  tags,
  summary: "The community's moderation log, newest first",
  security: ACCOUNT,
  request: { params: community, query: log },
  responses: {
    200: json("The entries", LogPage),
    ...INVALID,
    ...AUTHED,
    ...MODERATORS,
    ...NO_COMMUNITY,
  },
});

export const platformLogRoute = createRoute({
  method: "get",
  path: "/v1/moderation/log",
  operationId: "platformModerationLog",
  tags,
  summary: "Every community's moderation log, newest first",
  security: ACCOUNT,
  request: { query: log },
  responses: { 200: json("The entries", LogPage), ...INVALID, ...AUTHED, ...PLATFORM },
});
