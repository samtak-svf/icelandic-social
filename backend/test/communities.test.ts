import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { communityLifecycle } from "../src/community-lifecycle.ts";
import { expireCommunities } from "../src/modules/communities/index.ts";
import { device, euEnv } from "./support.ts";
import { worker } from "./main.ts";

// Communities and membership (decision 0063): every audience rule, with a
// blocked and a banned account, roles, and what deleting an owner does.

const BASE = "https://spjall.test";
const DAY_MS = 24 * 60 * 60 * 1000;

type Person = Awaited<ReturnType<typeof person>>;
type Community = {
  communityId: string;
  name: string;
  description: string;
  audience: "open" | "private";
  memberCount: number | null;
  role: string | null;
  joinRequested: boolean;
  invited: boolean;
  readOnly: boolean;
  deletedAt: number | null;
  joinDeclinedUntil: number | null;
  pendingJoinRequests: number | null;
};

async function person(name: string, verified = true) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = ? WHERE account_id = ?")
    .bind(name, verified ? 1 : 0, seeded.accountId)
    .run();
  const call = (method: string, path: string, body?: unknown) =>
    worker.fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...seeded.auth,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ...seeded, call };
}

const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

async function create(owner: Person, audience: "open" | "private", name = "Prjónaklúbbur") {
  const response = await owner.call("POST", "/v1/communities", { name, audience });
  expect(response.status).toBe(200);
  return (await response.json()) as Community;
}

async function get(by: Person, id: string) {
  const response = await by.call("GET", `/v1/communities/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Community;
}

async function join(by: Person, id: string) {
  const response = await by.call("POST", `/v1/communities/${id}/join`);
  return {
    status: response.status,
    body: (await response.json()) as { state?: string; error?: string },
  };
}

async function memberIds(by: Person, id: string) {
  const response = await by.call("GET", `/v1/communities/${id}/members`);
  if (response.status !== 200) return response.status;
  const { members } = (await response.json()) as { members: { accountId: string; role: string }[] };
  return members.map((m) => `${m.accountId}:${m.role}`);
}

describe("creating a community", () => {
  it("needs a verified account", async () => {
    const unverified = await person("Gúgla Notandi", false);
    const response = await unverified.call("POST", "/v1/communities", {
      name: "Klúbbur",
      audience: "open",
    });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("not_verified");
  });

  it("makes the creator its only member and owner", async () => {
    const owner = await person("Eigandi");
    const made = await create(owner, "open");
    expect(made).toMatchObject({
      role: "owner",
      memberCount: 1,
      audience: "open",
      readOnly: false,
    });
    expect(await memberIds(owner, made.communityId)).toEqual([`${owner.accountId}:owner`]);
  });

  it("refuses a name that is empty or too long", async () => {
    const owner = await person("Eigandi");
    for (const name of ["   ", "x".repeat(81)]) {
      const response = await owner.call("POST", "/v1/communities", { name, audience: "open" });
      expect(response.status).toBe(400);
    }
  });
});

describe("an open community", () => {
  it("is read by every signed-in account, which joins at once", async () => {
    const owner = await person("Eigandi");
    const stranger = await person("Ókunnugur", false);
    const { communityId } = await create(owner, "open");
    expect(await get(stranger, communityId)).toMatchObject({ memberCount: 1, role: null });
    expect(await memberIds(stranger, communityId)).toEqual([`${owner.accountId}:owner`]);
    expect(await join(stranger, communityId)).toEqual({ status: 200, body: { state: "member" } });
    expect(await get(stranger, communityId)).toMatchObject({ memberCount: 2, role: "member" });
  });

  it("needs a session to be read", async () => {
    const owner = await person("Eigandi");
    const { communityId } = await create(owner, "open");
    const response = await worker.fetch(`${BASE}/v1/communities/${communityId}`);
    expect(response.status).toBe(401);
  });

  it("may become private, and then its members are its own", async () => {
    const owner = await person("Eigandi");
    const stranger = await person("Ókunnugur");
    const { communityId } = await create(owner, "open");
    const response = await owner.call("PATCH", `/v1/communities/${communityId}`, {
      audience: "private",
    });
    expect(response.status).toBe(200);
    expect(await get(stranger, communityId)).toMatchObject({
      audience: "private",
      memberCount: null,
    });
    expect(await memberIds(stranger, communityId)).toBe(403);
  });
});

describe("a private community", () => {
  it("shows its name and description, never its members or their count", async () => {
    const owner = await person("Eigandi");
    const stranger = await person("Ókunnugur");
    const made = await create(owner, "private", "Leynifélagið");
    const seen = await get(stranger, made.communityId);
    expect(seen).toMatchObject({ name: "Leynifélagið", memberCount: null, role: null });
    expect(await memberIds(stranger, made.communityId)).toBe(403);
  });

  it("is joined by a request a moderator approves", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const member = await person("Félagi");
    const { communityId } = await create(owner, "private");
    await owner.call("PUT", `/v1/communities/${communityId}/invitations/${member.accountId}`);
    await join(member, communityId);

    expect(await join(asker, communityId)).toEqual({ status: 200, body: { state: "requested" } });
    expect(await get(asker, communityId)).toMatchObject({ joinRequested: true, role: null });
    // A member who does not moderate sees no requests.
    const refused = await member.call("GET", `/v1/communities/${communityId}/join-requests`);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    // Nor approves one.
    const approvedByMember = await member.call(
      "POST",
      `/v1/communities/${communityId}/join-requests/${asker.accountId}`,
    );
    expect(approvedByMember.status).toBe(403);

    const listed = await owner.call("GET", `/v1/communities/${communityId}/join-requests`);
    const { requests } = (await listed.json()) as { requests: { accountId: string }[] };
    expect(requests.map((r) => r.accountId)).toEqual([asker.accountId]);
    const approved = await owner.call(
      "POST",
      `/v1/communities/${communityId}/join-requests/${asker.accountId}`,
    );
    expect(approved.status).toBe(204);
    expect(await get(asker, communityId)).toMatchObject({
      role: "member",
      joinRequested: false,
      memberCount: 3,
    });
  });

  it("can decline a request, which the asker sees and waits 30 days on (0070)", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const { communityId } = await create(owner, "private");
    await join(asker, communityId);
    expect(await get(owner, communityId)).toMatchObject({ pendingJoinRequests: 1 });
    const declinedAt = Date.now();
    await owner.call("DELETE", `/v1/communities/${communityId}/join-requests/${asker.accountId}`);
    const seen = await get(asker, communityId);
    expect(seen).toMatchObject({ joinRequested: false, role: null, pendingJoinRequests: null });
    expect(seen.joinDeclinedUntil).toBeGreaterThanOrEqual(declinedAt + 30 * DAY_MS);
    expect(await get(owner, communityId)).toMatchObject({ pendingJoinRequests: 0 });
    const requests = await owner.call("GET", `/v1/communities/${communityId}/join-requests`);
    expect(await requests.json()).toEqual({ requests: [] });
    // Approving a request that no longer waits finds nothing.
    const late = await owner.call(
      "POST",
      `/v1/communities/${communityId}/join-requests/${asker.accountId}`,
    );
    expect(late.status).toBe(404);
    // Asking again, or withdrawing, does not lift the decline.
    expect(await join(asker, communityId)).toEqual({
      status: 409,
      body: expect.objectContaining({ error: "join_declined" }),
    });
    await asker.call("DELETE", `/v1/communities/${communityId}/join`);
    expect((await get(asker, communityId)).joinDeclinedUntil).not.toBeNull();
    // Its 30 days pass, and it may ask again.
    await expireCommunities(euEnv(env), communityLifecycle, declinedAt + 31 * DAY_MS);
    expect((await get(asker, communityId)).joinDeclinedUntil).toBeNull();
    expect(await join(asker, communityId)).toEqual({ status: 200, body: { state: "requested" } });
  });

  it("lifts a decline with an invitation", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const { communityId } = await create(owner, "private");
    await join(asker, communityId);
    await owner.call("DELETE", `/v1/communities/${communityId}/join-requests/${asker.accountId}`);
    await owner.call("PUT", `/v1/communities/${communityId}/invitations/${asker.accountId}`);
    expect(await get(asker, communityId)).toMatchObject({ invited: true, joinDeclinedUntil: null });
    expect(await join(asker, communityId)).toEqual({ status: 200, body: { state: "member" } });
  });

  it("lets a request be withdrawn, and shows the count only to moderators", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const member = await person("Meðlimur");
    const { communityId } = await create(owner, "private");
    await owner.call("PUT", `/v1/communities/${communityId}/invitations/${member.accountId}`);
    await join(member, communityId);
    await join(asker, communityId);
    expect(await get(owner, communityId)).toMatchObject({ pendingJoinRequests: 1 });
    expect(await get(member, communityId)).toMatchObject({ pendingJoinRequests: null });
    expect(await get(asker, communityId)).toMatchObject({ pendingJoinRequests: null });
    await asker.call("DELETE", `/v1/communities/${communityId}/join`);
    expect(await get(asker, communityId)).toMatchObject({
      joinRequested: false,
      joinDeclinedUntil: null,
    });
    expect(await get(owner, communityId)).toMatchObject({ pendingJoinRequests: 0 });
  });

  it("is joined at once by an account a moderator invited", async () => {
    const owner = await person("Eigandi");
    const guest = await person("Gestur");
    const { communityId } = await create(owner, "private");
    const invited = await owner.call(
      "PUT",
      `/v1/communities/${communityId}/invitations/${guest.accountId}`,
    );
    expect(invited.status).toBe(204);
    expect(await get(guest, communityId)).toMatchObject({ invited: true });
    expect(await join(guest, communityId)).toEqual({ status: 200, body: { state: "member" } });
  });

  it("approves a waiting request by inviting its account", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const { communityId } = await create(owner, "private");
    await join(asker, communityId);
    await owner.call("PUT", `/v1/communities/${communityId}/invitations/${asker.accountId}`);
    expect(await get(asker, communityId)).toMatchObject({ role: "member" });
  });

  it("never becomes open", async () => {
    const owner = await person("Eigandi");
    const { communityId } = await create(owner, "private");
    const response = await owner.call("PATCH", `/v1/communities/${communityId}`, {
      audience: "open",
    });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("audience_locked");
  });
});

describe("a block", () => {
  it("never removes anyone, nor stops a blocked account joining an open community", async () => {
    const owner = await person("Eigandi");
    const blocked = await person("Útilokaður");
    const member = await person("Félagi");
    const { communityId } = await create(owner, "open");
    await join(member, communityId);
    await join(blocked, communityId);
    await member.call("PUT", `/v1/blocks/${blocked.accountId}`);
    expect(await get(blocked, communityId)).toMatchObject({ role: "member", memberCount: 3 });

    // The two no longer see each other in the list; a moderator sees both.
    const seenByMember = await memberIds(member, communityId);
    expect(seenByMember).not.toContain(`${blocked.accountId}:member`);
    const seenByBlocked = await memberIds(blocked, communityId);
    expect(seenByBlocked).not.toContain(`${member.accountId}:member`);
    expect(await memberIds(owner, communityId)).toEqual(
      expect.arrayContaining([`${blocked.accountId}:member`, `${member.accountId}:member`]),
    );
  });

  it("refuses an invitation either way", async () => {
    const owner = await person("Eigandi");
    const blocker = await person("Útilokari");
    const blockedByOwner = await person("Útilokaður");
    const { communityId } = await create(owner, "private");
    await blocker.call("PUT", `/v1/blocks/${owner.accountId}`);
    await owner.call("PUT", `/v1/blocks/${blockedByOwner.accountId}`);
    for (const target of [blocker, blockedByOwner]) {
      const response = await owner.call(
        "PUT",
        `/v1/communities/${communityId}/invitations/${target.accountId}`,
      );
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("blocked");
    }
  });

  it("does not hide a join request from a moderator", async () => {
    const owner = await person("Eigandi");
    const asker = await person("Umsækjandi");
    const { communityId } = await create(owner, "private");
    await owner.call("PUT", `/v1/blocks/${asker.accountId}`);
    await join(asker, communityId);
    const listed = await owner.call("GET", `/v1/communities/${communityId}/join-requests`);
    const { requests } = (await listed.json()) as { requests: { accountId: string }[] };
    expect(requests.map((r) => r.accountId)).toEqual([asker.accountId]);
  });
});

describe("a banned account", () => {
  it("can neither join nor read, nor be invited", async () => {
    const owner = await person("Eigandi");
    const banned = await person("Bannaður");
    const open = await create(owner, "open");
    const closed = await create(owner, "private");
    for (const { communityId } of [open, closed]) {
      await env.DB.prepare(
        "INSERT INTO community_bans (community_id, account_id, created_at) VALUES (?, ?, ?)",
      )
        .bind(communityId, banned.accountId, Date.now())
        .run();
      const joined = await join(banned, communityId);
      expect(joined).toEqual({ status: 403, body: expect.objectContaining({ error: "banned" }) });
      expect(await memberIds(banned, communityId)).toBe(403);
      const invited = await owner.call(
        "PUT",
        `/v1/communities/${communityId}/invitations/${banned.accountId}`,
      );
      expect(await errorOf(invited)).toBe("banned");
    }
  });
});

describe("roles", () => {
  it("are set by the owner only, and a moderator then approves requests", async () => {
    const owner = await person("Eigandi");
    const helper = await person("Hjálpari");
    const asker = await person("Umsækjandi");
    const { communityId } = await create(owner, "private");
    await owner.call("PUT", `/v1/communities/${communityId}/invitations/${helper.accountId}`);
    await join(helper, communityId);

    const self = await helper.call(
      "PUT",
      `/v1/communities/${communityId}/members/${helper.accountId}/role`,
      {
        role: "moderator",
      },
    );
    expect(self.status).toBe(403);
    const made = await owner.call(
      "PUT",
      `/v1/communities/${communityId}/members/${helper.accountId}/role`,
      { role: "moderator" },
    );
    expect(made.status).toBe(204);

    await join(asker, communityId);
    const approved = await helper.call(
      "POST",
      `/v1/communities/${communityId}/join-requests/${asker.accountId}`,
    );
    expect(approved.status).toBe(204);
    // A moderator does not change the audience or delete the community.
    const patched = await helper.call("PATCH", `/v1/communities/${communityId}`, { name: "Nýtt" });
    expect(patched.status).toBe(403);
    const deleted = await helper.call("DELETE", `/v1/communities/${communityId}`);
    expect(deleted.status).toBe(403);
  });

  it("move with ownership: the old owner becomes a moderator", async () => {
    const owner = await person("Eigandi");
    const heir = await person("Erfingi");
    const outsider = await person("Utanaðkomandi");
    const { communityId } = await create(owner, "open");
    await join(heir, communityId);
    const toOutsider = await owner.call("PUT", `/v1/communities/${communityId}/owner`, {
      accountId: outsider.accountId,
    });
    expect(toOutsider.status).toBe(404);
    const handed = await owner.call("PUT", `/v1/communities/${communityId}/owner`, {
      accountId: heir.accountId,
    });
    expect(handed.status).toBe(204);
    expect(await memberIds(owner, communityId)).toEqual([
      `${heir.accountId}:owner`,
      `${owner.accountId}:moderator`,
    ]);
  });

  it("keep the owner in: it hands the community over before leaving", async () => {
    const owner = await person("Eigandi");
    const member = await person("Félagi");
    const { communityId } = await create(owner, "open");
    await join(member, communityId);
    const stuck = await owner.call("POST", `/v1/communities/${communityId}/leave`);
    expect(stuck.status).toBe(409);
    expect(await errorOf(stuck)).toBe("owner_cannot_leave");
    expect((await member.call("POST", `/v1/communities/${communityId}/leave`)).status).toBe(204);
    expect(await get(member, communityId)).toMatchObject({ role: null, memberCount: 1 });
  });

  it("let only the owner delete the community, of its members", async () => {
    const owner = await person("Eigandi");
    const moderator = await person("Stjórnandi");
    const { communityId } = await create(owner, "open");
    await join(moderator, communityId);
    await owner.call("PUT", `/v1/communities/${communityId}/members/${moderator.accountId}/role`, {
      role: "moderator",
    });
    expect((await moderator.call("DELETE", `/v1/communities/${communityId}`)).status).toBe(403);
    expect((await owner.call("DELETE", `/v1/communities/${communityId}`)).status).toBe(204);
    expect((await owner.call("GET", `/v1/communities/${communityId}`)).status).toBe(404);
  });
});

describe("deleting the owner's account", () => {
  it("hands the community to its longest-serving moderator", async () => {
    const owner = await person("Eigandi");
    const first = await person("Fyrri");
    const second = await person("Seinni");
    const { communityId } = await create(owner, "open");
    for (const m of [first, second]) {
      await join(m, communityId);
      await owner.call("PUT", `/v1/communities/${communityId}/members/${m.accountId}/role`, {
        role: "moderator",
      });
    }
    await env.DB.prepare(
      "UPDATE community_members SET joined_at = joined_at - 1000 WHERE account_id = ?",
    )
      .bind(first.accountId)
      .run();
    expect((await owner.call("DELETE", "/v1/me")).status).toBe(204);
    expect(await memberIds(second, communityId)).toEqual([
      `${first.accountId}:owner`,
      `${second.accountId}:moderator`,
    ]);
  });

  it("leaves one with no moderator read-only, and deleted 90 days later", async () => {
    const owner = await person("Eigandi");
    const member = await person("Félagi");
    const newcomer = await person("Nýliði");
    const { communityId } = await create(owner, "open");
    await join(member, communityId);
    await owner.call("DELETE", "/v1/me");
    expect(await get(member, communityId)).toMatchObject({ readOnly: true, memberCount: 1 });
    expect(await join(newcomer, communityId)).toEqual({
      status: 403,
      body: expect.objectContaining({ error: "read_only" }),
    });
    await expireCommunities(euEnv(env), communityLifecycle, Date.now() + 89 * DAY_MS);
    expect((await member.call("GET", `/v1/communities/${communityId}`)).status).toBe(200);
    await expireCommunities(euEnv(env), communityLifecycle, Date.now() + 91 * DAY_MS);
    expect((await member.call("GET", `/v1/communities/${communityId}`)).status).toBe(404);
  });
});

describe("discovery", () => {
  it("finds a name without case or the Icelandic letters, private ones too", async () => {
    const owner = await person("Eigandi");
    const tag = crypto.randomUUID().slice(0, 8);
    await create(owner, "open", `Þjóðlagasöngur ${tag}`);
    await create(owner, "private", `Ölgerð ${tag}`);
    const response = await owner.call(
      "GET",
      `/v1/communities?q=${encodeURIComponent(`THJODLAGA`)}`,
    );
    const { communities } = (await response.json()) as { communities: Community[] };
    expect(communities.map((c) => c.name)).toContain(`Þjóðlagasöngur ${tag}`);
    const other = await person("Annar");
    const found = await other.call("GET", `/v1/communities?q=${tag}`);
    const page = (await found.json()) as { communities: Community[] };
    expect(page.communities.map((c) => [c.name, c.memberCount])).toEqual([
      [`Ölgerð ${tag}`, null],
      [`Þjóðlagasöngur ${tag}`, 1],
    ]);
  });

  it("pages newest first", async () => {
    const owner = await person("Eigandi");
    const tag = crypto.randomUUID().slice(0, 8);
    for (const n of [1, 2, 3]) await create(owner, "open", `Síða ${n} ${tag}`);
    const first = (await (await owner.call("GET", `/v1/communities?q=${tag}&limit=2`)).json()) as {
      communities: Community[];
      next: string;
    };
    const second = (await (
      await owner.call("GET", `/v1/communities?q=${tag}&limit=2&after=${first.next}`)
    ).json()) as { communities: Community[]; next: string | null };
    const names = [...first.communities, ...second.communities].map((c) => c.name);
    expect(new Set(names).size).toBe(3);
    expect(second.next).toBeNull();
  });

  it("lists the caller's own communities", async () => {
    const owner = await person("Eigandi");
    const member = await person("Félagi");
    const a = await create(owner, "open", "Alfa");
    await create(owner, "open", "Beta");
    await join(member, a.communityId);
    const response = await member.call("GET", "/v1/me/communities");
    const { communities } = (await response.json()) as { communities: Community[] };
    expect(communities.map((c) => c.communityId)).toEqual([a.communityId]);
  });
});
