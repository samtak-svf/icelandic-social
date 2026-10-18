import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Communities (decision 0063): open or private, joined at once or by a
// request a moderator approves, with one owner, moderators and members.
// Nothing in a community is end-to-end encrypted.

const CommunityId = OpaqueId.openapi({ example: "cm_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });

const Audience = z.enum(["open", "private"]).openapi({
  description:
    "open: every signed-in account reads it and joins at once; private: only members read it, and joining takes a moderator's approval or an invitation",
});

const Role = z.enum(["owner", "moderator", "member"]);

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
    readOnly: z.boolean().openapi({
      description:
        "Its owner's account was deleted and no moderator was left to take it over; it is deleted 90 days later",
    }),
  })
  .openapi("Community");

const CommunityPage = z
  .object({
    communities: z.array(Community),
    next: z.string().nullable().openapi({ description: "The cursor of the next page" }),
  })
  .openapi("CommunityPage");

const Member = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable(),
    verified: z.boolean(),
    role: Role,
    joinedAt: z.int().openapi({ description: "Unix milliseconds" }),
  })
  .openapi("CommunityMember");

const JoinRequest = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable(),
    verified: z.boolean(),
    requestedAt: z.int().openapi({ description: "Unix milliseconds" }),
  })
  .openapi("JoinRequest");

const community = z.object({ communityId: CommunityId });
const communityMember = z.object({ communityId: CommunityId, accountId: OpaqueId });

const json = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

const NOT_FOUND = { 404: errorResponse("not_found: no such community") };
const MEMBERS_ONLY = {
  403: errorResponse("not_a_member: a private community's members and their list are its own"),
};
const MODERATORS_ONLY = {
  403: errorResponse("not_permitted: only the community's moderators and its owner may do this"),
};
const OWNER_ONLY = { 403: errorResponse("not_permitted: only the community's owner may do this") };

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
  security: ACCOUNT,
  request: { params: community },
  responses: {
    204: { description: "Deleted" },
    ...INVALID,
    ...AUTHED,
    ...OWNER_ONLY,
    ...NOT_FOUND,
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
  },
});

export const withdrawJoinRequestRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}/join",
  operationId: "withdrawJoinRequest",
  tags: ["communities"],
  summary: "Withdraw the caller's join request, or decline an invitation",
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

export const listMembersRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/members",
  operationId: "listCommunityMembers",
  tags: ["communities"],
  summary: "The members, owner and moderators first",
  description:
    "An open community's are visible to every signed-in account, a private one's to its members. Accounts a block stands between are left out, except for a moderator.",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    200: json("The members", z.object({ members: z.array(Member) })),
    ...INVALID,
    ...AUTHED,
    ...MEMBERS_ONLY,
    ...NOT_FOUND,
  },
});

export const listJoinRequestsRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/join-requests",
  operationId: "listJoinRequests",
  tags: ["communities"],
  summary: "The join requests that wait, oldest first",
  security: ACCOUNT,
  request: { params: community },
  responses: {
    200: json("The requests", z.object({ requests: z.array(JoinRequest) })),
    ...INVALID,
    ...AUTHED,
    ...MODERATORS_ONLY,
    ...NOT_FOUND,
  },
});

export const approveJoinRequestRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/join-requests/{accountId}",
  operationId: "approveJoinRequest",
  tags: ["communities"],
  summary: "Approve a join request: the account becomes a member",
  security: ACCOUNT,
  request: { params: communityMember },
  responses: {
    204: { description: "A member" },
    ...INVALID,
    ...AUTHED,
    ...MODERATORS_ONLY,
    404: errorResponse("not_found: no such community, or no such request"),
  },
});

export const declineJoinRequestRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}/join-requests/{accountId}",
  operationId: "declineJoinRequest",
  tags: ["communities"],
  summary: "Decline a join request",
  security: ACCOUNT,
  request: { params: communityMember },
  responses: {
    204: { description: "No request waits" },
    ...INVALID,
    ...AUTHED,
    ...MODERATORS_ONLY,
    ...NOT_FOUND,
  },
});

export const inviteMemberRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/invitations/{accountId}",
  operationId: "inviteToCommunity",
  tags: ["communities"],
  summary: "Invite an account to a community; it joins when it accepts",
  description:
    "A join request the account already made is approved instead. An account that blocked the inviter, or that the community banned, cannot be invited.",
  security: ACCOUNT,
  request: { params: communityMember },
  responses: {
    204: { description: "Invited, or a member already" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse(
      "not_permitted: only moderators invite; blocked: a block stands between the two; banned: the account is banned",
    ),
    404: errorResponse("not_found: no such community or account"),
  },
});

export const setRoleRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/members/{accountId}/role",
  operationId: "setCommunityRole",
  tags: ["communities"],
  summary: "Make a member a moderator, or a moderator a member again",
  security: ACCOUNT,
  request: {
    params: communityMember,
    body: {
      content: {
        "application/json": { schema: z.object({ role: z.enum(["moderator", "member"]) }) },
      },
    },
  },
  responses: {
    204: { description: "The role is set" },
    ...INVALID,
    ...AUTHED,
    ...OWNER_ONLY,
    404: errorResponse("not_found: no such community, or the account is not a member"),
  },
});

export const transferOwnershipRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/owner",
  operationId: "transferCommunity",
  tags: ["communities"],
  summary: "Hand the community to another member; the owner becomes a moderator",
  security: ACCOUNT,
  request: {
    params: community,
    body: { content: { "application/json": { schema: z.object({ accountId: OpaqueId }) } } },
  },
  responses: {
    204: { description: "The member owns it" },
    ...INVALID,
    ...AUTHED,
    ...OWNER_ONLY,
    404: errorResponse("not_found: no such community, or the account is not a member"),
  },
});
