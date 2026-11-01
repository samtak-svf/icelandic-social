import { createRoute, z } from "@hono/zod-openapi";
import { LIMITS } from "../limits.gen.ts";
import { Framing } from "./image-frames.ts";
import { Post } from "./social.ts";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, PhotoVersion } from "./common.ts";

// Communities (decision 0063): open or private, joined at once or by a
// request a moderator approves, with one owner, moderators and members.
// Nothing in a community is end-to-end encrypted.

export const CommunityId = OpaqueId.openapi({ example: "cm_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });

const Audience = z.enum(["open", "private"]).openapi({
  description:
    "open: every signed-in account reads it and joins at once; private: only members read it, and joining takes a moderator's approval or an invitation",
});

export const Role = z.enum(["owner", "moderator", "member"]);

const Name = z.string().trim().min(1).max(LIMITS.communityNameChars);
const Description = z.string().trim().max(LIMITS.communityDescriptionChars);

const Community = z
  .object({
    communityId: CommunityId,
    name: Name,
    description: z.string(),
    audience: Audience,
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
    memberCount: z.int().nullable().openapi({
      description: "null for a private community the caller is not a member of",
    }),
    role: Role.nullable().openapi({ description: "The caller's role; null when not a member" }),
    joinRequested: z.boolean().openapi({ description: "The caller's join request waits" }),
    invited: z.boolean().openapi({ description: "A moderator invited the caller" }),
    mutedUntil: z.int().nullable().openapi({
      description:
        "Until when (Unix milliseconds) a moderator muted the caller here: it reads, but does not post, comment or react",
    }),
    readOnly: z.boolean().openapi({
      description:
        "Its owner's account was deleted and no moderator was left to take it over; it is deleted 90 days later",
    }),
    deletedAt: z.int().nullable().openapi({
      description:
        "When it was deleted (Unix milliseconds); only a platform moderator sees a deleted community, and restores it within 30 days",
    }),
    restorableUntil: z.int().nullable().openapi({
      description:
        "Until when a platform moderator can restore it (Unix milliseconds), or null when it is not deleted",
    }),
    joinDeclinedUntil: z.int().nullable().openapi({
      description:
        "A moderator declined the caller's join request: it may ask again from this time (Unix milliseconds)",
    }),
    pendingJoinRequests: z.int().nullable().openapi({
      description: "How many join requests wait; null unless the caller moderates the community",
    }),
    openReports: z.int().nullable().openapi({
      description: "How many open reports wait; null unless the caller moderates the community",
    }),
    anonymousPosts: z.boolean().openapi({
      description:
        "Members may post without their name, for a moderator's approval (decision 0091)",
    }),
    pendingAnonymous: z.int().openapi({
      description: "How many anonymous posts wait for approval; 0 unless the caller moderates",
    }),
    photo: PhotoVersion.openapi({
      description:
        "The community's picture version, changed by each upload; null when it has none (decision 0080). The picture is GET /v1/communities/{communityId}/avatar",
    }),
    cover: PhotoVersion.openapi({
      description:
        "The community's cover version, changed by each upload; null when it has none (decision 0080). The cover is GET /v1/communities/{communityId}/cover",
    }),
    photoFrames: Framing.nullable().openapi({
      description:
        "How the picture is framed (decision 0086); null without a picture or for one stored before frames",
    }),
    coverFrames: Framing.nullable().openapi({
      description:
        "How the cover is framed, with the rectangle of each size class set by hand (decision 0086); null without a cover or for one stored before frames",
    }),
    unread: z.int().openapi({
      description:
        "Posts made since the caller last opened the community's feed, counted from a sequence the server keeps: a post later deleted or removed still counts. 0 for a caller who is not a member (decision 0080)",
    }),
    lastPostAt: z.int().nullable().openapi({
      description:
        "When the latest post was made (Unix milliseconds); null when there is none, or for a private community the caller is not a member of (decision 0080)",
    }),
    pinned: z.boolean().openapi({
      description: "The caller pinned it to the top of its own list (decision 0080)",
    }),
    featured: z.array(Post).openapi({
      description:
        "The posts its moderators feature, up to three, newest pin first, as the caller may read them (decision 0088). Filled by getCommunity only, empty elsewhere and for a caller who may not read the community",
    }),
  })
  .openapi("Community");

const CommunityPage = z
  .object({
    communities: z.array(Community),
    next: z.string().nullable().openapi({ description: "The cursor of the next page" }),
  })
  .openapi("CommunityPage");

export const community = z.object({ communityId: CommunityId });

export const json = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

export const NOT_FOUND = { 404: errorResponse("not_found: no such community") };
export const MEMBERS_ONLY = {
  403: errorResponse("not_a_member: a private community's members and their list are its own"),
};
export const MODERATORS_ONLY = {
  403: errorResponse("not_permitted: only the community's moderators and its owner may do this"),
};
export const OWNER_ONLY = {
  403: errorResponse("not_permitted: only the community's owner may do this"),
};

export const createCommunityRoute = createRoute({
  method: "post",
  path: "/v1/communities",
  operationId: "createCommunity",
  tags: ["communities"],
  summary: "Create a community, with the caller as its owner",
  description: "Only an account Kenni verified may create one (decision 0063).",
  security: ACCOUNT,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: Name,
            description: Description.default(""),
            audience: Audience,
          }),
        },
      },
    },
  },
  responses: {
    200: json("The new community", Community),
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "suspended: the account is suspended now, with `until` when it ends (decision 0115); not_verified: the account is not verified",
    ),
  },
});

export const listCommunitiesRoute = createRoute({
  method: "get",
  path: "/v1/communities",
  operationId: "listCommunities",
  tags: ["communities"],
  summary: "Discover communities, newest first",
  description:
    "Every community's name and description is visible to a signed-in account; a private one's members and posts are not. `q` keeps those whose name contains it, without case.",
  security: ACCOUNT,
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(LIMITS.communitySearchChars).optional(),
      after: z
        .string()
        .regex(/^\d{1,16}-[A-Za-z0-9_]{1,64}$/)
        .optional()
        .openapi({ description: "From `next`" }),
      limit: z.coerce.number().int().min(1).max(50).default(30),
    }),
  },
  responses: { 200: json("A page", CommunityPage), ...INVALID, ...AUTHED },
});

export const myCommunitiesRoute = createRoute({
  method: "get",
  path: "/v1/me/communities",
  operationId: "myCommunities",
  tags: ["communities"],
  summary: "The communities the caller belongs to, by name",
  security: ACCOUNT,
  responses: {
    200: json("The communities", z.object({ communities: z.array(Community) })),
    ...AUTHED,
  },
});

export const pinCommunityRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/pin",
  operationId: "pinCommunity",
  tags: ["communities"],
  summary: "Pin a community to the top of the caller's own list",
  description:
    "Stored per account, so the pin follows the caller to every device; the pinned communities come first in `myCommunities`, the earliest pin first. Pinning twice is one pin (decision 0080).",
  security: ACCOUNT,
  request: { params: community },
  responses: { 204: { description: "Pinned" }, ...INVALID, ...AUTHED, ...NOT_FOUND },
});

export const unpinCommunityRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}/pin",
  operationId: "unpinCommunity",
  tags: ["communities"],
  summary: "Unpin a community",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    204: { description: "Not pinned, whether it was or not" },
    ...INVALID,
    ...AUTHED,
    ...NOT_FOUND,
  },
});

export const getCommunityRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}",
  operationId: "getCommunity",
  tags: ["communities"],
  summary: "One community",
  security: ACCOUNT,
  request: { params: community },
  responses: { 200: json("The community", Community), ...INVALID, ...AUTHED, ...NOT_FOUND },
});

export const updateCommunityRoute = createRoute({
  method: "patch",
  path: "/v1/communities/{communityId}",
  operationId: "updateCommunity",
  tags: ["communities"],
  summary: "Rename a community, change its description, or make an open one private",
  description:
    "Only the owner. A private community never becomes open: its members joined on that promise (decision 0063).",
  security: ACCOUNT,
  request: {
    params: community,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: Name.optional(),
            description: Description.optional(),
            audience: Audience.optional(),
            anonymousPosts: z.boolean().optional().openapi({
              description:
                "Let members post without their name (decision 0091); every such post waits for a moderator's approval. A change is logged",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: json("The community", Community),
    ...INVALID,
    ...AUTHED,
    ...OWNER_ONLY,
    ...NOT_FOUND,
    409: errorResponse("audience_locked: a private community cannot become open"),
  },
});

export const deleteCommunityRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}",
  operationId: "deleteCommunity",
  tags: ["communities"],
  summary: "Delete a community and everything in it",
  description:
    "The owner, or a platform moderator. It is gone at once for everyone; a platform moderator can restore it for 30 days, then its content is deleted. Its moderation log and reports are kept a year (decision 0070).",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    204: { description: "Deleted" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_permitted: only the owner or a platform moderator may do this"),
    ...NOT_FOUND,
  },
});

export const restoreCommunityRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/restore",
  operationId: "restoreCommunity",
  tags: ["communities"],
  summary: "Restore a deleted community, within 30 days of its deletion",
  description: "Only a platform moderator (decision 0070). Restoring a live one is no error.",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    200: json("The community", Community),
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_permitted: only a platform moderator may do this"),
    ...NOT_FOUND,
    409: errorResponse("purged: its 30 days are past and its content is deleted"),
  },
});

export const joinCommunityRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/join",
  operationId: "joinCommunity",
  tags: ["communities"],
  summary: "Join an open community, or ask to join a private one",
  description:
    "An open community, or a private one that invited the caller, is joined at once. Otherwise a join request waits for a moderator. Asking again is no error.",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    200: json(
      "member: the caller is in; requested: a moderator decides",
      z.object({ state: z.enum(["member", "requested"]) }),
    ),
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "suspended: the account is suspended now, with `until` when it ends (decision 0115); banned: the community banned the caller; read_only: it takes no one",
    ),
    ...NOT_FOUND,
    409: errorResponse(
      "join_declined: a moderator declined the caller's request; it may ask again at `joinDeclinedUntil`",
    ),
  },
});

export const withdrawJoinRequestRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}/join",
  operationId: "withdrawJoinRequest",
  tags: ["communities"],
  summary: "Withdraw the caller's join request, or decline an invitation",
  description: "A request a moderator declined stays until its 30 days pass.",
  security: ACCOUNT,
  request: { params: community },
  responses: { 204: { description: "None waits" }, ...INVALID, ...AUTHED },
});

export const leaveCommunityRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/leave",
  operationId: "leaveCommunity",
  tags: ["communities"],
  summary: "Leave a community",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    204: { description: "Not a member, whether it was or not" },
    ...INVALID,
    ...AUTHED,
    409: errorResponse("owner_cannot_leave: the owner hands the community to a member first"),
  },
});
