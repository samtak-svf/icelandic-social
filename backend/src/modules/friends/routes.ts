import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  acceptFriendRequestRoute,
  cancelFriendRequestRoute,
  declineFriendRequestRoute,
  endFriendshipRoute,
  friendSuggestionSettingsRoute,
  getPersonRoute,
  listFriendRequestsRoute,
  listFriendSuggestionsRoute,
  listFriendsRoute,
  listSnoozesRoute,
  putFriendSuggestionSettingsRoute,
  sendFriendRequestRoute,
  snoozeRoute,
  unsnoozeRoute,
} from "../../api/friends.ts";
import type { AppEnv } from "../../http.ts";
import { inSuggestions, notSuspended, setInSuggestions } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { decodeDirectoryCursor } from "../profiles/index.ts";
import { friendList } from "./friendships.ts";
import { personView } from "./person.ts";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  endFriendship,
  requestLists,
  sendRequest,
  type WithdrawNotice,
} from "./requests.ts";
import { snooze, snoozeList, unsnooze } from "./snoozes.ts";
import { suggestions } from "./suggestions.ts";

// The routes of friends (decision 0114). Sending a request is new contact, so a
// suspension stops it (0115). Accepting, declining, cancelling and ending are
// the account's own safety and answers to contact it already has, so none of
// them is stopped. Log lines carry ids only (0008), and a name search is never logged.

export function friendRoutes(
  app: OpenAPIHono<AppEnv>,
  { withdraw }: { withdraw: WithdrawNotice },
): void {
  app.openapi(getPersonRoute, async (c) => {
    const found = await personView(c.env, c.var.session.accountId, c.req.valid("param").accountId);
    return found ? c.json(found, 200) : fail(c, 404, "not_found");
  });

  app.openapi(listFriendsRoute, async (c) => {
    const { q, sort } = c.req.valid("query");
    return c.json(
      await friendList(c.env, c.var.session.accountId, {
        sort,
        ...(q === undefined ? {} : { query: q }),
      }),
      200,
    );
  });

  app.openapi(endFriendshipRoute, async (c) => {
    const { accountId } = c.var.session;
    await endFriendship(c.env, accountId, c.req.valid("param").accountId);
    log("friendship.ended", { accountId });
    return c.body(null, 204);
  });

  app.openapi(listFriendRequestsRoute, async (c) =>
    c.json(await requestLists(c.env, c.var.session.accountId), 200),
  );

  app.openapi(notSuspended(sendFriendRequestRoute), async (c) => {
    const { accountId } = c.var.session;
    const to = c.req.valid("param").accountId;
    if (to === accountId) return fail(c, 400, "invalid_request");
    const sent = await sendRequest(c.env, accountId, to, withdraw);
    if ("refused" in sent) {
      if (sent.refused === "not_found") return fail(c, 404, "not_found");
      return fail(c, sent.refused === "request_limit" ? 429 : 409, sent.refused);
    }
    log("friend_request.sent", { accountId });
    return c.json(sent, 200);
  });

  app.openapi(cancelFriendRequestRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await cancelRequest(c.env, accountId, c.req.valid("param").accountId, withdraw))) {
      return fail(c, 404, "not_found");
    }
    log("friend_request.cancelled", { accountId });
    return c.body(null, 204);
  });

  app.openapi(acceptFriendRequestRoute, async (c) => {
    const { accountId } = c.var.session;
    const answered = await acceptRequest(
      c.env,
      accountId,
      c.req.valid("param").accountId,
      withdraw,
    );
    if (answered === "none") return fail(c, 404, "not_found");
    if (answered === "friend_limit") return fail(c, 409, "friend_limit");
    log("friend_request.accepted", { accountId });
    return c.body(null, 204);
  });

  app.openapi(declineFriendRequestRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await declineRequest(c.env, accountId, c.req.valid("param").accountId, withdraw))) {
      return fail(c, 404, "not_found");
    }
    log("friend_request.declined", { accountId });
    return c.body(null, 204);
  });

  app.openapi(listFriendSuggestionsRoute, async (c) => {
    const { after, limit } = c.req.valid("query");
    const cursor = after === undefined ? undefined : decodeDirectoryCursor(after);
    if (cursor === null) return fail(c, 400, "invalid_request");
    const found = await suggestions(c.env, c.var.session.accountId, { after: cursor, limit });
    return c.json({ people: found.items, next: found.next }, 200);
  });

  app.openapi(friendSuggestionSettingsRoute, async (c) =>
    c.json({ included: await inSuggestions(c.env, c.var.session.accountId) }, 200),
  );

  // Stepping out is the account's own safety, so a suspension does not stop it.
  app.openapi(putFriendSuggestionSettingsRoute, async (c) => {
    await setInSuggestions(c.env, c.var.session.accountId, c.req.valid("json").included);
    return c.body(null, 204);
  });

  app.openapi(listSnoozesRoute, async (c) =>
    c.json({ snoozed: await snoozeList(c.env, c.var.session.accountId) }, 200),
  );

  app.openapi(snoozeRoute, async (c) => {
    const { accountId } = c.var.session;
    const target = c.req.valid("param").accountId;
    if (target === accountId) return fail(c, 400, "invalid_request");
    const until = await snooze(c.env, accountId, target);
    if (until === undefined) return fail(c, 404, "not_found");
    log("person.snoozed", { accountId });
    return c.json({ until }, 200);
  });

  app.openapi(unsnoozeRoute, async (c) => {
    const { accountId } = c.var.session;
    await unsnooze(c.env, accountId, c.req.valid("param").accountId);
    log("person.unsnoozed", { accountId });
    return c.body(null, 204);
  });
}
