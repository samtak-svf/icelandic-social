import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, PhotoVersion } from "./common.ts";
import { Profile } from "./accounts.ts";

// Friends (decision 0114): a person's screen, the requests, the account's own
// lists and a snooze. A sender can never tell a declined request from a pending
// or an expired one, so no shape here carries a request's state or closing time.

const account = z.object({ accountId: OpaqueId });

const SharedCommunity = z
  .object({ communityId: OpaqueId, name: z.string(), photo: PhotoVersion })
  .openapi("SharedCommunity");

const Relation = z.enum(["self", "none", "sent", "incoming", "friends"]).openapi("Relation", {
  description:
    "Between the caller and this person. `sent` stands for 30 days from the request whatever the other did; `incoming` means the other asked",
});

const Person = Profile.extend({
  relation: Relation,
  friendsSince: z
    .int()
    .nullable()
    .openapi({ description: "Unix milliseconds; null unless friends" }),
  friendCount: z.int().openapi({ description: "How many friends the person has" }),
  mutualCount: z.int().openapi({ description: "How many of them are the caller's too" }),
  mutualFriends: z.array(Profile).openapi({ description: "The first of them, by name" }),
  sharedCommunities: z
    .array(SharedCommunity)
    .openapi({ description: "The first of those both are members of, by name" }),
  snoozedUntil: z
    .int()
    .nullable()
    .openapi({ description: "Unix milliseconds; null unless the caller snoozed this person" }),
}).openapi("Person");

const FriendPage = z
  .object({
    count: z.int().openapi({ description: "All the caller's friends, whatever `q` kept" }),
    friends: z.array(
      z.object({
        person: Profile,
        since: z.int().openapi({ description: "Unix milliseconds" }),
      }),
    ),
  })
  .openapi("FriendPage");

const FriendRequest = z
  .object({ person: Profile, sentAt: z.int().openapi({ description: "Unix milliseconds" }) })
  .openapi("FriendRequest");

const FriendRequests = z
  .object({
    incoming: z.array(FriendRequest).openapi({ description: "To the caller, newest first" }),
    sent: z
      .array(FriendRequest)
      .openapi({ description: "From the caller and still standing, newest first" }),
  })
  .openapi("FriendRequests");

const SnoozeList = z
  .object({
    snoozed: z.array(
      z.object({
        person: Profile,
        until: z.int().openapi({ description: "Unix milliseconds" }),
      }),
    ),
  })
  .openapi("SnoozeList");

const FriendSuggestions = z
  .object({
    people: z.array(Profile).openapi({ description: "Verified first, then by name" }),
    next: z
      .string()
      .nullable()
      .openapi({ description: "The cursor of the next page, null on the last" }),
  })
  .openapi("FriendSuggestions");

const FriendSuggestionSettings = z
  .object({
    included: z.boolean().openapi({
      description:
        "False takes the account out both ways: it is suggested to nobody and shown nobody",
    }),
  })
  .openapi("FriendSuggestionSettings");

const noRequest = { 404: errorResponse("not_found: no such standing request") };
const friendLimit = errorResponse("friend_limit: one of the two already has 1,000 friends");

export const getPersonRoute = createRoute({
  method: "get",
  path: "/v1/people/{accountId}",
  operationId: "getPerson",
  tags: ["friends"],
  summary: "A person's screen: mark, shared communities, friend count and mutual friends (0114)",
  description:
    "Answers 404 across a block in either direction, where `getAccount` goes on answering, so a blocked person sees what anyone sees of a missing page.",
  security: ACCOUNT,
  request: { params: account },
  responses: {
    200: { description: "The person", content: { "application/json": { schema: Person } } },
    ...INVALID,
    404: errorResponse("not_found: no such account, or a block between the two"),
    ...AUTHED,
  },
});

export const listFriendsRoute = createRoute({
  method: "get",
  path: "/v1/friends",
  operationId: "listFriends",
  tags: ["friends"],
  summary: "The caller's own friends; nobody else's are ever listed",
  security: ACCOUNT,
  request: {
    query: z.object({
      q: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .openapi({ description: "The start of a name or of a word in it" }),
      sort: z.enum(["newest", "name"]).default("newest"),
    }),
  },
  responses: {
    200: { description: "The whole list", content: { "application/json": { schema: FriendPage } } },
    ...INVALID,
    ...AUTHED,
  },
});

export const endFriendshipRoute = createRoute({
  method: "delete",
  path: "/v1/friends/{accountId}",
  operationId: "endFriendship",
  tags: ["friends"],
  summary: "End a friendship; nobody is told, and ending one that is not there is no error",
  security: ACCOUNT,
  request: { params: account },
  responses: { 204: { description: "Ended" }, ...INVALID, ...AUTHED },
});

export const listFriendRequestsRoute = createRoute({
  method: "get",
  path: "/v1/friend-requests",
  operationId: "listFriendRequests",
  tags: ["friends"],
  summary: "The requests standing for the caller, to it and from it",
  security: ACCOUNT,
  responses: {
    200: { description: "Both lists", content: { "application/json": { schema: FriendRequests } } },
    ...AUTHED,
  },
});

export const sendFriendRequestRoute = createRoute({
  method: "put",
  path: "/v1/friend-requests/{accountId}",
  operationId: "sendFriendRequest",
  tags: ["friends"],
  summary: "Ask to be friends; asking the one who asked is accepting them",
  description:
    "One request per direction per 90 days from the last one's creation, whatever became of it, with one refusal for all of them. Asking again while a request stands changes nothing.",
  security: ACCOUNT,
  request: { params: account },
  responses: {
    200: {
      description: "Where the two now stand",
      content: {
        "application/json": { schema: z.object({ relation: z.enum(["sent", "friends"]) }) },
      },
    },
    400: errorResponse("invalid_request: the account is the caller's own"),
    403: errorResponse("suspended: this account is suspended (decision 0115)"),
    404: errorResponse("not_found: no such account, or a block between the two"),
    409: errorResponse(
      "request_refused: not again yet; friend_limit: one of the two already has 1,000 friends",
    ),
    429: errorResponse("request_limit: 20 new requests in the last 24 hours"),
    ...AUTHED,
  },
});

export const cancelFriendRequestRoute = createRoute({
  method: "delete",
  path: "/v1/friend-requests/{accountId}",
  operationId: "cancelFriendRequest",
  tags: ["friends"],
  summary: "Take back a request the caller sent; its 90 days go on",
  security: ACCOUNT,
  request: { params: account },
  responses: { 204: { description: "Taken back" }, ...INVALID, ...noRequest, ...AUTHED },
});

export const acceptFriendRequestRoute = createRoute({
  method: "post",
  path: "/v1/friend-requests/{accountId}/accept",
  operationId: "acceptFriendRequest",
  tags: ["friends"],
  summary: "Accept the request this person sent; they are told",
  security: ACCOUNT,
  request: { params: account },
  responses: {
    204: { description: "Friends" },
    ...INVALID,
    ...noRequest,
    409: friendLimit,
    ...AUTHED,
  },
});

export const declineFriendRequestRoute = createRoute({
  method: "post",
  path: "/v1/friend-requests/{accountId}/decline",
  operationId: "declineFriendRequest",
  tags: ["friends"],
  summary: "Decline the request this person sent; nobody is told",
  security: ACCOUNT,
  request: { params: account },
  responses: { 204: { description: "Declined" }, ...INVALID, ...noRequest, ...AUTHED },
});

export const listFriendSuggestionsRoute = createRoute({
  method: "get",
  path: "/v1/friend-suggestions",
  operationId: "listFriendSuggestions",
  tags: ["friends"],
  summary: "People the caller shares an open community with (0114)",
  description:
    "Never from a private community, mutual friends or contacts, and nothing says which community links two people. Leaves out friends, either direction of a block or of a request in its 90 days, and a suspended or opted-out account. Empty for a caller who is opted out or suspended.",
  security: ACCOUNT,
  request: {
    query: z.object({
      after: z.string().min(1).max(600).optional().openapi({ description: "From `next`" }),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: {
    200: {
      description: "A page",
      content: { "application/json": { schema: FriendSuggestions } },
    },
    400: errorResponse("invalid_request: the query, or a cursor not from `next`"),
    ...AUTHED,
  },
});

export const friendSuggestionSettingsRoute = createRoute({
  method: "get",
  path: "/v1/friend-suggestion-settings",
  operationId: "friendSuggestionSettings",
  tags: ["friends"],
  summary: "Whether the caller takes part in friend suggestions; it does until it says otherwise",
  security: ACCOUNT,
  responses: {
    200: {
      description: "The setting",
      content: { "application/json": { schema: FriendSuggestionSettings } },
    },
    ...AUTHED,
  },
});

export const putFriendSuggestionSettingsRoute = createRoute({
  method: "put",
  path: "/v1/friend-suggestion-settings",
  operationId: "putFriendSuggestionSettings",
  tags: ["friends"],
  summary: "Take the caller into or out of friend suggestions, both ways",
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/json": { schema: FriendSuggestionSettings } } },
  },
  responses: { 204: { description: "Stored" }, ...INVALID, ...AUTHED },
});

export const listSnoozesRoute = createRoute({
  method: "get",
  path: "/v1/snoozes",
  operationId: "listSnoozes",
  tags: ["friends"],
  summary: "The people the caller has snoozed, the soonest back first",
  security: ACCOUNT,
  responses: {
    200: { description: "The list", content: { "application/json": { schema: SnoozeList } } },
    ...AUTHED,
  },
});

export const snoozeRoute = createRoute({
  method: "put",
  path: "/v1/snoozes/{accountId}",
  operationId: "snoozePerson",
  tags: ["friends"],
  summary: "Hide a person's posts from the caller's feed for 30 days; nobody is told",
  security: ACCOUNT,
  request: { params: account },
  responses: {
    200: {
      description: "Snoozed",
      content: {
        "application/json": {
          schema: z.object({ until: z.int().openapi({ description: "Unix milliseconds" }) }),
        },
      },
    },
    400: errorResponse("invalid_request: the account is the caller's own"),
    404: errorResponse("not_found: no such account"),
    ...AUTHED,
  },
});

export const unsnoozeRoute = createRoute({
  method: "delete",
  path: "/v1/snoozes/{accountId}",
  operationId: "unsnoozePerson",
  tags: ["friends"],
  summary: "Lift a snooze early; lifting one that is not there is no error",
  security: ACCOUNT,
  request: { params: account },
  responses: { 204: { description: "Lifted" }, ...INVALID, ...AUTHED },
});
