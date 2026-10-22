import { createRoute, z } from "@hono/zod-openapi";
import { MAX_PHOTO_UPLOAD } from "./accounts.ts";
import {
  ACCOUNT,
  AUTHED,
  errorResponse,
  INVALID,
  OpaqueId,
  PhotoVersion,
  RATE_LIMITED,
} from "./common.ts";

// Communities (decision 0063): open or private, joined at once or by a
// request a moderator approves, with one owner, moderators and members.
// Nothing in a community is end-to-end encrypted.

export const CommunityId = OpaqueId.openapi({ example: "cm_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });

const Audience = z.enum(["open", "private"]).openapi({
  description:
    "open: every signed-in account reads it and joins at once; private: only members read it, and joining takes a moderator's approval or an invitation",
});

export const Role = z.enum(["owner", "moderator", "member"]);

const Name = z.string().trim().min(1).max(80);
const Description = z.string().trim().max(500);

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
    photo: PhotoVersion.openapi({
      description:
        "The community's picture version, changed by each upload; null when it has none (decision 0080). The picture is GET /v1/communities/{communityId}/avatar",
    }),
    cover: PhotoVersion.openapi({
      description:
        "The community's cover version, changed by each upload; null when it has none (decision 0080). The cover is GET /v1/communities/{communityId}/cover",
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
    403: errorResponse("not_verified: the account is not verified"),
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
      q: z.string().trim().min(1).max(80).optional(),
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
    403: errorResponse("banned: the community banned the caller; read_only: it takes no one"),
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

// A community's picture and cover (decision 0080): the account photo's path
// with another size and key. Written by the owner and the moderators, read by
// whoever may read the community.

const Binary = z.string().openapi({ type: "string", format: "binary" });

const imageRoutes = (which: "avatar" | "cover", noun: string, size: string) => {
  const Which = which === "avatar" ? "Avatar" : "Cover";
  const Set = z
    .object({ version: OpaqueId.openapi({ description: `The new ${noun}'s version` }) })
    .openapi(`Community${Which}Set`);
  const base = {
    tags: ["communities"],
    security: ACCOUNT,
    request: { params: community },
  };
  return {
    put: createRoute({
      ...base,
      method: "put",
      path: `/v1/communities/{communityId}/${which}`,
      operationId: `setCommunity${Which}`,
      summary: `Set or replace a community's ${noun} (decision 0080)`,
      description:
        `The body is an image (JPEG, PNG, WebP, GIF or AVIF) of at most ${MAX_PHOTO_UPLOAD / 1024 / 1024} MB, with a ` +
        `Content-Length. The server re-encodes it to a ${size} WebP without metadata and keeps ` +
        `only that. Only the community's owner and its moderators may; the change is a ` +
        `moderation log entry. It is not end-to-end encrypted.`,
      request: {
        params: community,
        body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
      },
      responses: {
        200: json("Stored", Set),
        400: errorResponse(
          "invalid_request: no Content-Length, or a body of another length; " +
            "invalid_image: not an image the server can decode",
        ),
        413: errorResponse("too_large: more than 10 MB"),
        ...MODERATORS_ONLY,
        ...NOT_FOUND,
        ...RATE_LIMITED,
        ...AUTHED,
      },
    }),
    delete: createRoute({
      ...base,
      method: "delete",
      path: `/v1/communities/{communityId}/${which}`,
      operationId: `removeCommunity${Which}`,
      summary: `Remove a community's ${noun} (decision 0080)`,
      description:
        "Only the community's owner and its moderators may; the change is a moderation log entry.",
      responses: {
        204: { description: `No ${noun}, whether there was one or not` },
        ...MODERATORS_ONLY,
        ...NOT_FOUND,
        ...INVALID,
        ...AUTHED,
      },
    }),
    get: createRoute({
      ...base,
      method: "get",
      path: `/v1/communities/{communityId}/${which}`,
      operationId: `getCommunity${Which}`,
      summary: `A community's ${noun}, a ${size} WebP (decision 0080)`,
      description:
        "An open community's is readable by any signed-in account; a private community's only by its members.",
      responses: {
        200: { description: `The ${noun}`, content: { "image/webp": { schema: Binary } } },
        ...INVALID,
        404: errorResponse(
          `not_found: no such community, no ${noun}, or the caller may not read the community`,
        ),
        ...AUTHED,
      },
    }),
  };
};

const avatar = imageRoutes("avatar", "picture", "512 by 512");
const cover = imageRoutes("cover", "cover", "1600 by 600");
export const putCommunityAvatarRoute = avatar.put;
export const deleteCommunityAvatarRoute = avatar.delete;
export const getCommunityAvatarRoute = avatar.get;
export const putCommunityCoverRoute = cover.put;
export const deleteCommunityCoverRoute = cover.delete;
export const getCommunityCoverRoute = cover.get;
