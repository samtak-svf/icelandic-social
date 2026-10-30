import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  createCommunityRoute,
  deleteCommunityRoute,
  getCommunityRoute,
  joinCommunityRoute,
  leaveCommunityRoute,
  listCommunitiesRoute,
  myCommunitiesRoute,
  pinCommunityRoute,
  restoreCommunityRoute,
  unpinCommunityRoute,
  updateCommunityRoute,
  withdrawJoinRequestRoute,
} from "../../api/communities.ts";
import {
  approveJoinRequestRoute,
  declineJoinRequestRoute,
  inviteMemberRoute,
  listJoinRequestsRoute,
  listMembersRoute,
  setRoleRoute,
  transferOwnershipRoute,
} from "../../api/community-members.ts";
import type { AppEnv } from "../../http.ts";
import { notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { canRead, moderates } from "./access.ts";
import {
  communitiesOf,
  createCommunity,
  discover,
  isVerified,
  joinRequests,
  members,
  standing,
  updateCommunity,
  view,
} from "./communities.ts";
import { pinCommunity, unpinCommunity } from "./hub.ts";
import {
  addMember,
  approve,
  decline,
  invite,
  removeMember,
  requestToJoin,
  setRole,
  transfer,
  withdraw,
} from "./membership.ts";
import { communityImageRoutes } from "./images.ts";
import { type LifecycleHooks, markDeleted, restore } from "./lifecycle.ts";

// The routes of communities and membership (decision 0063). A log line
// carries the account and the community's ids, never a name (0008).

export function communityRoutes(app: OpenAPIHono<AppEnv>, hooks: LifecycleHooks): void {
  app.openapi(notSuspended(createCommunityRoute), async (c) => {
    const { accountId } = c.var.session;
    if (!(await isVerified(c.env, accountId))) return fail(c, 403, "not_verified");
    const created = await createCommunity(c.env, accountId, c.req.valid("json"));
    log("community.created", { accountId, communityId: created.communityId });
    return c.json(view(created), 200);
  });

  app.openapi(listCommunitiesRoute, async (c) => {
    const { q, after, limit } = c.req.valid("query");
    const [createdAt, id] = after?.split("-") ?? [];
    const found = await discover(c.env, c.var.session.accountId, {
      query: q,
      after: id === undefined ? undefined : { createdAt: Number(createdAt), id },
      limit,
    });
    return c.json({ communities: found.items.map((s) => view(s)), next: found.next }, 200);
  });

  app.openapi(myCommunitiesRoute, async (c) =>
    c.json(
      { communities: (await communitiesOf(c.env, c.var.session.accountId)).map((s) => view(s)) },
      200,
    ),
  );

  app.openapi(pinCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found || !canRead(found)) return fail(c, 404, "not_found");
    await pinCommunity(c.env, accountId, communityId);
    return c.body(null, 204);
  });

  app.openapi(unpinCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found || !canRead(found)) return fail(c, 404, "not_found");
    await unpinCommunity(c.env, accountId, communityId);
    return c.body(null, 204);
  });

  app.openapi(getCommunityRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, c.var.session.accountId, communityId, { deleted: true });
    if (!found) return fail(c, 404, "not_found");
    const featured = await hooks.featured(c.env, c.var.session.accountId, communityId);
    return c.json(view(found, featured), 200);
  });

  app.openapi(updateCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (found.role !== "owner") return fail(c, 403, "not_permitted");
    const change = c.req.valid("json");
    if (found.audience === "private" && change.audience === "open") {
      return fail(c, 409, "audience_locked");
    }
    // Only a change of the switch is logged (decision 0091), in the batch that makes it.
    const switched =
      change.anonymousPosts !== undefined && change.anonymousPosts !== found.anonymousPosts;
    await updateCommunity(
      c.env,
      communityId,
      change,
      switched
        ? [hooks.recordAnonymous(c.env, communityId, accountId, !!change.anonymousPosts)]
        : [],
    );
    log("community.updated", { accountId, communityId });
    const updated = await standing(c.env, accountId, communityId);
    return updated ? c.json(view(updated), 200) : fail(c, 404, "not_found");
  });

  app.openapi(deleteCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    // The owner, or Samtak (decision 0063); either way it can be restored (0070).
    if (found.role !== "owner" && !found.platformModerator) return fail(c, 403, "not_permitted");
    if (await markDeleted(c.env, communityId, accountId, hooks)) {
      log("community.deleted", { accountId, communityId });
    }
    return c.body(null, 204);
  });

  app.openapi(restoreCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId, { deleted: true });
    if (!found) return fail(c, 404, "not_found");
    if (!found.platformModerator) return fail(c, 403, "not_permitted");
    if (found.deletedAt === null) return c.json(view(found), 200);
    if (found.purged || !(await restore(c.env, communityId, accountId, hooks))) {
      return fail(c, 409, "purged");
    }
    log("community.restored", { accountId, communityId });
    const restored = await standing(c.env, accountId, communityId);
    return restored ? c.json(view(restored), 200) : fail(c, 404, "not_found");
  });

  app.openapi(notSuspended(joinCommunityRoute), async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (found.role) return c.json({ state: "member" as const }, 200);
    if (found.banned) return fail(c, 403, "banned");
    if (found.readOnly) return fail(c, 403, "read_only");
    if (found.joinDeclinedUntil !== null && !found.invited) return fail(c, 409, "join_declined");
    if (found.audience === "open" || found.invited) {
      await addMember(c.env, communityId, accountId);
      log("community.joined", { accountId, communityId });
      return c.json({ state: "member" as const }, 200);
    }
    await requestToJoin(c.env, communityId, accountId);
    log("community.join_requested", { accountId, communityId });
    return c.json({ state: "requested" as const }, 200);
  });

  app.openapi(withdrawJoinRequestRoute, async (c) => {
    await withdraw(c.env, c.req.valid("param").communityId, c.var.session.accountId);
    return c.body(null, 204);
  });

  app.openapi(leaveCommunityRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (found?.role === "owner") return fail(c, 409, "owner_cannot_leave");
    if (found?.role) {
      await removeMember(c.env, communityId, accountId);
      log("community.left", { accountId, communityId });
    }
    return c.body(null, 204);
  });

  app.openapi(listMembersRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (!canRead(found)) return fail(c, 403, "not_a_member");
    return c.json({ members: await members(c.env, accountId, communityId, moderates(found)) }, 200);
  });

  app.openapi(listJoinRequestsRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, c.var.session.accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (!moderates(found)) return fail(c, 403, "not_permitted");
    return c.json({ requests: await joinRequests(c.env, communityId) }, 200);
  });

  app.openapi(approveJoinRequestRoute, async (c) => {
    const { communityId, accountId: target } = c.req.valid("param");
    const { accountId } = c.var.session;
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (!moderates(found)) return fail(c, 403, "not_permitted");
    if (!(await approve(c.env, communityId, target, accountId))) return fail(c, 404, "not_found");
    log("community.request_approved", { accountId, communityId });
    return c.body(null, 204);
  });

  app.openapi(declineJoinRequestRoute, async (c) => {
    const { communityId, accountId: target } = c.req.valid("param");
    const { accountId } = c.var.session;
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (!moderates(found)) return fail(c, 403, "not_permitted");
    await decline(c.env, communityId, target);
    log("community.request_declined", { accountId, communityId });
    return c.body(null, 204);
  });

  app.openapi(notSuspended(inviteMemberRoute), async (c) => {
    const { communityId, accountId: target } = c.req.valid("param");
    const { accountId } = c.var.session;
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (!moderates(found) || found.readOnly) return fail(c, 403, "not_permitted");
    const theirs = await standing(c.env, target, communityId);
    if (theirs?.banned) return fail(c, 403, "banned");
    if (theirs?.role) return c.body(null, 204);
    const invited = await invite(c.env, communityId, accountId, target);
    if (invited === "missing") return fail(c, 404, "not_found");
    if (invited === "blocked") return fail(c, 403, "blocked");
    log("community.invited", { accountId, communityId });
    return c.body(null, 204);
  });

  app.openapi(setRoleRoute, async (c) => {
    const { communityId, accountId: target } = c.req.valid("param");
    const { accountId } = c.var.session;
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (found.role !== "owner") return fail(c, 403, "not_permitted");
    if (!(await setRole(c.env, communityId, target, c.req.valid("json").role))) {
      return fail(c, 404, "not_found");
    }
    log("community.role_set", { accountId, communityId });
    return c.body(null, 204);
  });

  app.openapi(transferOwnershipRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const { accountId } = c.var.session;
    const found = await standing(c.env, accountId, communityId);
    if (!found) return fail(c, 404, "not_found");
    if (found.role !== "owner") return fail(c, 403, "not_permitted");
    if (!(await transfer(c.env, communityId, accountId, c.req.valid("json").accountId))) {
      return fail(c, 404, "not_found");
    }
    log("community.transferred", { accountId, communityId });
    return c.body(null, 204);
  });

  communityImageRoutes(app, hooks);
}
