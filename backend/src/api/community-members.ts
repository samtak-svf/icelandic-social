import { createRoute, z } from "@hono/zod-openapi";
import {
  community,
  CommunityId,
  json,
  MEMBERS_ONLY,
  MODERATORS_ONLY,
  NOT_FOUND,
  OWNER_ONLY,
  Role,
} from "./communities.ts";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, PhotoVersion } from "./common.ts";

// A community's members (decision 0063): who is in it and in what role, the
// join requests a moderator answers, invitations, and the owner's hand-over.

const Member = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable(),
    verified: z.boolean(),
    photo: PhotoVersion,
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

const communityMember = z.object({ communityId: CommunityId, accountId: OpaqueId });

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
  description: "Declined requests are not listed.",
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
  description:
    "The account sees that it was declined, and may ask again after 30 days; an invitation lifts the decline (decision 0070).",
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
      "suspended: the account is suspended now, with `until` when it ends (decision 0115); not_permitted: only moderators invite; blocked: a block stands between the two; banned: the account is banned",
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
