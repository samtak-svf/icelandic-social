import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";
import { body, json, log, PLATFORM, reason, REVIEW_OUTCOMES, Target, tags } from "./moderation.ts";
import { Author } from "./social.ts";

// The statement of reasons and the single review (decisions 0063, 0115). The
// person whose content it was reads what was done and why, never who did it,
// and may ask once for a review; a platform moderator who did not act decides.

/** What a person may ask to have reviewed: not a sanction on a member of a community. */
export const REVIEWABLE = [
  "hide_post",
  "remove_post",
  "hide_comment",
  "remove_comment",
  "clear_account_photo",
  "suspend_account",
] as const;

const EntryId = z
  .string()
  .regex(/^\d{1,16}$/)
  .openapi({ description: "The log entry of the action" });
const entry = z.object({ entryId: EntryId });
const Action = z.enum(REVIEWABLE);
const At = z.int().openapi({ description: "Unix milliseconds" });

const Review = z
  .object({
    state: z.enum(["open", "upheld", "overturned"]),
    askedAt: At,
    decidedAt: At.nullable(),
    reason: z.string().nullable().openapi({ description: "The decider's reason, once decided" }),
    restored: z.boolean().openapi({
      description:
        "The content is back, or the suspension is lifted. False on an overturned review when it no longer exists, as a cleared photo does not, or when a later hide, remove or suspension still stands",
    }),
  })
  .openapi("ModerationReview");

const Statement = z
  .object({
    entryId: z.int(),
    action: Action,
    target: Target,
    communityId: OpaqueId.nullable(),
    reason: z.string().openapi({ description: "The moderator's reason, as written" }),
    createdAt: At,
    until: At.nullable().openapi({
      description:
        "The end a suspension was given when it was decided; null on any other action and on a suspension until a moderator lifts it",
    }),
    body: z.string().nullable().openapi({
      description: "The text the action was on, while it is kept (90 days after a removal, 0063)",
    }),
    canAsk: z.boolean().openapi({
      description: "No review was asked for yet and the content has not come back since",
    }),
    review: z.union([Review, z.null()]),
  })
  .openapi("ModerationStatement", { description: "Why a moderator acted. Never names who did" });

const StatementPage = z
  .object({
    statements: z.array(Statement),
    next: z.string().nullable().openapi({ description: "The cursor of the next, older page" }),
  })
  .openapi("ModerationStatementPage");

const OpenReview = z
  .object({
    entryId: z.int(),
    action: Action,
    target: Target,
    communityId: OpaqueId.nullable(),
    postId: OpaqueId.nullable().openapi({
      description: "The post to open, when the target is a post or a comment on one",
    }),
    // null once the actor's account is deleted.
    actor: z.union([Author, z.null()]),
    // null on an anonymous post (decision 0091), and once the account is deleted.
    targetAccount: z.union([Author, z.null()]),
    reason: z.string(),
    createdAt: At,
    until: At.nullable().openapi({
      description:
        "The end a suspension was given when it was decided; null on any other action and on a suspension until a moderator lifts it",
    }),
    body: z.string().nullable().openapi({
      description: "The text, while it is kept; null means the decision is made without it",
    }),
    askedAt: At,
    canDecide: z.boolean().openapi({
      description: "False for the moderator who acted and for the person who asked",
    }),
  })
  .openapi("OpenModerationReview");

const OpenReviewPage = z
  .object({
    reviews: z.array(OpenReview),
    next: z.string().nullable().openapi({ description: "The cursor of the next, older page" }),
  })
  .openapi("OpenModerationReviewPage");

const Decision = z
  .object({ outcome: z.enum(REVIEW_OUTCOMES), reason })
  .openapi("ModerationReviewDecision");

export const statementsRoute = createRoute({
  method: "get",
  path: "/v1/moderation/statements",
  operationId: "moderationStatements",
  tags,
  summary: "What moderators did to the caller's content and why, newest first",
  security: ACCOUNT,
  request: { query: log },
  responses: { 200: json("The statements", StatementPage), ...INVALID, ...AUTHED },
});

export const askReviewRoute = createRoute({
  method: "post",
  path: "/v1/moderation/statements/{entryId}/review",
  operationId: "askModerationReview",
  tags,
  summary: "Asks once for a review of an action on the caller's content",
  security: ACCOUNT,
  request: { params: entry },
  responses: {
    204: { description: "Asked" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such action on the caller's content that can be reviewed"),
    409: errorResponse(
      "already_asked: this action had its one review; restored: the content is back already",
    ),
  },
});

export const openReviewsRoute = createRoute({
  method: "get",
  path: "/v1/moderation/reviews",
  operationId: "openModerationReviews",
  tags,
  summary: "The reviews waiting for a platform moderator, newest first",
  security: ACCOUNT,
  request: { query: log },
  responses: { 200: json("The reviews", OpenReviewPage), ...INVALID, ...AUTHED, ...PLATFORM },
});

export const decideReviewRoute = createRoute({
  method: "post",
  path: "/v1/moderation/reviews/{entryId}",
  operationId: "decideModerationReview",
  tags,
  summary: "Upholds or overturns an action; both are logged and the person is told",
  security: ACCOUNT,
  request: { params: entry, body: body(Decision) },
  responses: {
    204: { description: "Decided" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "not_permitted: not a platform moderator, or the one who acted or asked: nobody decides their own",
    ),
    404: errorResponse("not_found: no such review"),
    409: errorResponse("already_decided: this review has its answer"),
  },
});
