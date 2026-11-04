import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { communityLifecycle } from "../../../src/compose/community-lifecycle.ts";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { expireCommunities } from "../../../src/modules/communities/index.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { worker } from "../../main.ts";
import { community, errorOf, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { type Page, recorder, run, tick } from "./support.ts";

// A community invitation is noticed, answered and withdrawable (decision 0130).

const DAY = 24 * 60 * 60 * 1000;
const NEWEST = () => `android/${env.INVITE_NOTICE_CLIENT_VERSION}`;

const read = async (one: Person, client = NEWEST(), path = "/v1/notifications") =>
  ok<Page>(
    await worker.fetch(`https://spjall.test${path}`, {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );

const invites = async (one: Person) =>
  (await read(one)).notifications.filter((n) => n.kind === "community_invite");

const rowsOf = async (accountId: string) =>
  (
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE kind = 'community_invite' AND account_id = ?",
    )
      .bind(accountId)
      .first<{ n: number }>()
  )?.n;

const invite = (by: Person, id: string, who: Person) =>
  by.call("PUT", `/v1/communities/${id}/invitations/${who.accountId}`);

/** A private community, its owner, and a person the owner invited, with the notice run. */
async function scene() {
  const owner = await person("Eigandi");
  const guest = await person("Gestur");
  const id = await community(owner, "private");
  expect((await invite(owner, id, guest)).status).toBe(204);
  const push = recorder();
  await run(push);
  return { owner, guest, id, push };
}

describe("the notice of an invitation", () => {
  it("is one row to the invited person, with the inviter as its actor", async () => {
    const { owner, guest, id, push } = await scene();
    const rows = await invites(guest);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      communityId: id,
      actor: { accountId: owner.accountId },
      actorCount: 1,
      read: false,
    });
    // Pushed to the invited person's device, which names nothing.
    expect(push.sent).toEqual([guest.deviceId]);
    expect(await invites(owner)).toEqual([]);
  });

  it("is not written twice when the person is invited again", async () => {
    const { owner, guest, id } = await scene();
    await tick();
    expect((await invite(owner, id, guest)).status).toBe(204);
    await run(recorder());
    expect(await rowsOf(guest.accountId)).toBe(1);
  });

  it("is written again for a new invitation after the first ended", async () => {
    const { owner, guest, id } = await scene();
    expect((await guest.call("DELETE", `/v1/communities/${id}/join`)).status).toBe(204);
    await tick();
    expect((await invite(owner, id, guest)).status).toBe(204);
    await run(recorder());
    expect(await rowsOf(guest.accountId)).toBe(1);
  });

  it("is never grouped with another invitation", async () => {
    const owner = await person("Eigandi");
    const guest = await person("Gestur");
    const first = await community(owner, "private");
    const second = await community(owner, "private");
    await invite(owner, first, guest);
    await invite(owner, second, guest);
    await run(recorder());
    expect(await rowsOf(guest.accountId)).toBe(2);
  });

  it("is written without a push at in_app and not at all at off", async () => {
    const owner = await person("Eigandi");
    const quiet = await person("Hljóður");
    const silent = await person("Þögull");
    const id = await community(owner, "private");
    await quiet.call("PUT", "/v1/notification-settings", { kinds: { community_invite: "in_app" } });
    await silent.call("PUT", "/v1/notification-settings", { kinds: { community_invite: "off" } });
    await invite(owner, id, quiet);
    await invite(owner, id, silent);
    const push = recorder();
    await run(push);
    expect(await rowsOf(quiet.accountId)).toBe(1);
    expect(await rowsOf(silent.accountId)).toBe(0);
    expect(push.sent).toEqual([]);
  });

  it("is not written when the invitation ended before the job ran", async () => {
    const owner = await person("Eigandi");
    const guest = await person("Gestur");
    const id = await community(owner, "private");
    await invite(owner, id, guest);
    await env.DB.prepare("DELETE FROM community_invitations WHERE account_id = ?")
      .bind(guest.accountId)
      .run();
    await run(recorder());
    expect(await rowsOf(guest.accountId)).toBe(0);
  });
});

describe("the notice goes when the invitation ends", () => {
  it("on a decline", async () => {
    const { guest, id } = await scene();
    expect((await guest.call("DELETE", `/v1/communities/${id}/join`)).status).toBe(204);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("on an accept", async () => {
    const { guest, id } = await scene();
    expect((await guest.call("POST", `/v1/communities/${id}/join`)).status).toBe(200);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("on a moderator's withdrawal", async () => {
    const { owner, guest, id } = await scene();
    const response = await owner.call(
      "DELETE",
      `/v1/communities/${id}/invitations/${guest.accountId}`,
    );
    expect(response.status).toBe(204);
    expect(await rowsOf(guest.accountId)).toBe(0);
    // The invitation is gone, so the person cannot join a private community by it.
    const joined = await ok<{ state: string }>(
      await guest.call("POST", `/v1/communities/${id}/join`),
    );
    expect(joined.state).toBe("requested");
  });

  it("on a ban", async () => {
    const { owner, guest, id } = await scene();
    const response = await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "ban_member",
      targetId: guest.accountId,
      reason: "Prófun",
    });
    expect(response.status).toBe(204);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("when a request the invitation answers is approved", async () => {
    const owner = await person("Eigandi");
    const guest = await person("Gestur");
    const id = await community(owner, "private");
    await invite(owner, id, guest);
    await run(recorder());
    await env.DB.prepare(
      "INSERT INTO community_join_requests (community_id, account_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, guest.accountId, Date.now())
      .run();
    expect(
      (await owner.call("POST", `/v1/communities/${id}/join-requests/${guest.accountId}`)).status,
    ).toBe(204);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("when the community is deleted for good", async () => {
    const { owner, guest, id } = await scene();
    expect((await owner.call("DELETE", `/v1/communities/${id}`)).status).toBe(204);
    // Deleted, it is out of sight at once.
    expect(await invites(guest)).toEqual([]);
    await expireCommunities(euEnv(env), communityLifecycle, Date.now() + 31 * DAY);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("when the invited account is deleted", async () => {
    const { guest } = await scene();
    await deleteAccount(euEnv(env), guest.accountId);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });

  it("when the inviter's account is deleted", async () => {
    const owner = await person("Eigandi");
    const moderator = await person("Umsjónarmaður");
    const guest = await person("Gestur");
    const id = await community(owner, "private", moderator);
    await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
      role: "moderator",
    });
    await invite(moderator, id, guest);
    await run(recorder());
    expect(await rowsOf(guest.accountId)).toBe(1);
    await deleteAccount(euEnv(env), moderator.accountId);
    expect(await rowsOf(guest.accountId)).toBe(0);
  });
});

describe("what an older client is shown", () => {
  it("keeps the kind from a build below the version that knows it", async () => {
    const { guest } = await scene();
    for (const platform of ["android", "ios"]) {
      const page = await read(guest, `${platform}/0.22.9`);
      expect(page.notifications.map((n) => n.kind)).toEqual([]);
      expect(page.unread).toBe(0);
      expect(page.unseen).toBe(0);
    }
    const knowing = await read(guest);
    expect(knowing.notifications.map((n) => n.kind)).toEqual(["community_invite"]);
    expect(knowing.unread).toBe(1);
  });

  it("does not mark it read for a build that does not show it", async () => {
    const { guest } = await scene();
    const upTo = Date.now() + 1000;
    const marked = await worker.fetch("https://spjall.test/v1/notifications/read", {
      method: "POST",
      headers: {
        ...guest.auth,
        [CLIENT_HEADER]: "android/0.22.9",
        "content-type": "application/json",
      },
      body: JSON.stringify({ upTo }),
    });
    expect(marked.status).toBe(204);
    expect((await read(guest)).unread).toBe(1);
  });
});

describe("the moderators' list of invitations", () => {
  it("names the invited, the inviter and the time, newest first", async () => {
    const owner = await person("Eigandi");
    const first = await person("Fyrsti");
    const second = await person("Annar");
    const id = await community(owner, "private");
    await invite(owner, id, first);
    await tick();
    await invite(owner, id, second);
    const listed = await ok<{
      invitations: {
        accountId: string;
        name: string;
        invitedBy: { accountId: string; name: string } | null;
        createdAt: number;
      }[];
    }>(await owner.call("GET", `/v1/communities/${id}/invitations`));
    expect(listed.invitations.map((i) => [i.accountId, i.name])).toEqual([
      [second.accountId, "Annar"],
      [first.accountId, "Fyrsti"],
    ]);
    expect(listed.invitations[0]?.invitedBy).toEqual({
      accountId: owner.accountId,
      name: "Eigandi",
    });
    expect(listed.invitations[0]?.createdAt).toBeGreaterThan(listed.invitations[1]!.createdAt);
  });

  it("has a null inviter for an invitation from before the record", async () => {
    const { owner, guest, id } = await scene();
    await env.DB.prepare("UPDATE community_invitations SET invited_by = NULL").run();
    const listed = await ok<{ invitations: { invitedBy: unknown }[] }>(
      await owner.call("GET", `/v1/communities/${id}/invitations`),
    );
    expect(listed.invitations).toHaveLength(1);
    expect(listed.invitations[0]?.invitedBy).toBeNull();
    expect((await invites(guest)).length).toBe(1);
  });

  it("names the inviter as null once the inviter's account is gone", async () => {
    const owner = await person("Eigandi");
    const moderator = await person("Umsjónarmaður");
    const guest = await person("Gestur");
    const id = await community(owner, "private", moderator);
    await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
      role: "moderator",
    });
    await invite(moderator, id, guest);
    await deleteAccount(euEnv(env), moderator.accountId);
    const listed = await ok<{ invitations: { invitedBy: unknown }[] }>(
      await owner.call("GET", `/v1/communities/${id}/invitations`),
    );
    expect(listed.invitations[0]?.invitedBy).toBeNull();
  });

  it("is for moderators only, to read and to withdraw", async () => {
    const owner = await person("Eigandi");
    const member = await person("Félagi");
    const outsider = await person("Utanaðkomandi");
    const guest = await person("Gestur");
    const id = await community(owner, "private", member);
    await invite(owner, id, guest);
    for (const who of [member, outsider]) {
      const listed = await who.call("GET", `/v1/communities/${id}/invitations`);
      const withdrawn = await who.call(
        "DELETE",
        `/v1/communities/${id}/invitations/${guest.accountId}`,
      );
      // A private community shows its name to anyone, so both are refused, not hidden.
      expect([listed.status, withdrawn.status]).toEqual([403, 403]);
      expect(await errorOf(listed)).toBe("not_permitted");
      expect(await errorOf(withdrawn)).toBe("not_permitted");
    }
    const still = await ok<{ invitations: unknown[] }>(
      await owner.call("GET", `/v1/communities/${id}/invitations`),
    );
    expect(still.invitations).toHaveLength(1);
  });

  it("answers 404 for a withdrawal of an invitation that is not there", async () => {
    const owner = await person("Eigandi");
    const nobody = await person("Enginn");
    const id = await community(owner, "private");
    const response = await owner.call(
      "DELETE",
      `/v1/communities/${id}/invitations/${nobody.accountId}`,
    );
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("not_found");
  });

  it("drops a withdrawn invitation from the list", async () => {
    const { owner, guest, id } = await scene();
    await owner.call("DELETE", `/v1/communities/${id}/invitations/${guest.accountId}`);
    const listed = await ok<{ invitations: unknown[] }>(
      await owner.call("GET", `/v1/communities/${id}/invitations`),
    );
    expect(listed.invitations).toEqual([]);
  });
});

describe("who the community says invited the caller", () => {
  const view = async (one: Person, id: string) =>
    ok<{ invited: boolean; invitedBy: { accountId: string; name: string } | null }>(
      await one.call("GET", `/v1/communities/${id}`),
    );

  it("is the inviter for the invited person and null for everyone else", async () => {
    const { owner, guest, id } = await scene();
    const bystander = await person("Vegfarandi");
    expect(await view(guest, id)).toMatchObject({
      invited: true,
      invitedBy: { accountId: owner.accountId, name: "Eigandi" },
    });
    expect(await view(owner, id)).toMatchObject({ invited: false, invitedBy: null });
    expect(await view(bystander, id)).toMatchObject({ invited: false, invitedBy: null });
  });

  it("is null for an invitation that has no inviter", async () => {
    const { guest, id } = await scene();
    await env.DB.prepare("UPDATE community_invitations SET invited_by = NULL").run();
    expect(await view(guest, id)).toMatchObject({ invited: true, invitedBy: null });
  });
});
