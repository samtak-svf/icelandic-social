import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { expireFriendRequests } from "../../../src/compose/friends.ts";
import { errorOf, ok, person, platformModerator, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import {
  accept,
  age,
  ask,
  cancel,
  decline,
  friendIds,
  noticesAs,
  relation,
  requests,
  unfriend,
} from "./support.ts";

// A friend request's states (decision 0114), each row of its table as a test.

const pair = async (): Promise<[Person, Person]> => [await person("Anna"), await person("Bjarni")];

describe("a friend request", () => {
  it("stands for both sides once sent", async () => {
    const [a, b] = await pair();
    expect(await ok(await ask(a, b))).toEqual({ relation: "sent" });
    expect(await relation(a, b)).toBe("sent");
    expect(await relation(b, a)).toBe("incoming");
    expect((await requests(a)).sent.map((r) => r.person.accountId)).toEqual([b.accountId]);
    expect((await requests(b)).incoming.map((r) => r.person.accountId)).toEqual([a.accountId]);
  });

  it("makes friends both ways when accepted, and clears both lists", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    expect((await accept(b, a)).status).toBe(204);
    expect(await relation(a, b)).toBe("friends");
    expect(await relation(b, a)).toBe("friends");
    expect(await friendIds(a)).toEqual([b.accountId]);
    expect(await friendIds(b)).toEqual([a.accountId]);
    expect((await requests(a)).sent).toEqual([]);
    expect((await requests(b)).incoming).toEqual([]);
  });

  it("is accepted by asking the one who already asked, and counts for nobody", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    expect(await ok(await ask(b, a))).toEqual({ relation: "friends" });
    expect(await friendIds(a)).toEqual([b.accountId]);
  });

  it("changes nothing when sent again while it stands", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    expect(await ok(await ask(a, b))).toEqual({ relation: "sent" });
    expect((await requests(b)).incoming.length).toBe(1);
  });

  it("answers friends when the two are friends already", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    await accept(b, a);
    expect(await ok(await ask(a, b))).toEqual({ relation: "friends" });
  });

  it("is gone from the recipient's side once declined", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    expect((await decline(b, a)).status).toBe(204);
    expect(await relation(b, a)).toBe("none");
    expect((await requests(b)).incoming).toEqual([]);
    expect((await accept(b, a)).status).toBe(404);
  });

  it("is gone from both sides once cancelled", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    expect((await cancel(a, b)).status).toBe(204);
    expect(await relation(a, b)).toBe("none");
    expect(await relation(b, a)).toBe("none");
    expect((await requests(b)).incoming).toEqual([]);
  });

  it("cannot be answered past its 30 days", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    await age(a, b, 31);
    expect(await relation(b, a)).toBe("none");
    expect((await accept(b, a)).status).toBe(404);
    expect((await decline(b, a)).status).toBe(404);
  });

  it("is not sent to nobody, or to oneself", async () => {
    const a = await person("Anna");
    const nobody = await a.call("PUT", "/v1/friend-requests/00000000000000000000000000");
    expect([400, 404]).toContain(nobody.status);
    expect((await ask(a, a)).status).toBe(400);
  });

  it("restarts no clock when a friendship ends", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    await accept(b, a);
    expect((await unfriend(b, a)).status).toBe(204);
    expect(await relation(a, b)).toBe("none");
    expect(await friendIds(a)).toEqual([]);
    expect(await errorOf(await ask(a, b))).toBe("request_refused");
    await age(a, b, 91);
    expect(await ok(await ask(a, b))).toEqual({ relation: "sent" });
  });

  it("refuses the 21st in a day, and counts one that was cancelled", async () => {
    const asker = await person("Anna");
    const first = await person("Fyrst");
    await ask(asker, first);
    await cancel(asker, first);
    for (let i = 0; i < 19; i += 1) {
      expect((await ask(asker, await person(`Viðtakandi ${i}`))).status).toBe(200);
    }
    const last = await person("Síðast");
    const refused = await ask(asker, last);
    expect(refused.status).toBe(429);
    expect(await errorOf(refused)).toBe("request_limit");
    expect(await relation(asker, last)).toBe("none");
  });

  it("is not asked by a suspended account, which can still answer and end", async () => {
    const [one, asker, friend, stranger] = [
      await person("Í banni"),
      await person("Spyr"),
      await person("Vinur"),
      await person("Ókunnugur"),
    ];
    await ask(asker, one);
    await ask(friend, one);
    await accept(one, friend);
    const moderator = await platformModerator("Samtak");
    const suspended = await moderator.call("POST", "/v1/moderation/actions", {
      action: "suspend_account",
      targetId: one.accountId,
      reason: "Ástæðan",
    });
    expect(suspended.status).toBe(204);

    const refused = await ask(one, stranger);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("suspended");
    expect((await accept(one, asker)).status).toBe(204);
    expect((await unfriend(one, friend)).status).toBe(204);
    expect((await unfriend(one, asker)).status).toBe(204);
  });

  it("is expired by the sweep, which later removes the row", async () => {
    const [a, b] = await pair();
    await ask(a, b);
    await age(a, b, 31);
    expect(await expireFriendRequests(euEnv(env))).toBeGreaterThan(0);
    const row = () =>
      env.DB.prepare("SELECT state FROM friend_requests WHERE from_account = ?")
        .bind(a.accountId)
        .first<{ state: string }>();
    expect((await row())?.state).toBe("expired");
    await age(a, b, 91);
    await expireFriendRequests(euEnv(env));
    expect(await row()).toBeNull();
  });
});

// The sender may never learn a decline (0114). So the same request is walked
// through every route its sender can call, one row per moment in its life,
// declined in one world and left alone in the other, and the two must match.
describe("what the sender can learn of a decline", () => {
  /** Everything the sender's routes say about `to`, with the ids taken out. */
  const seenBy = async (from: Person, to: Person) => {
    const screen = await from.call("GET", `/v1/people/${to.accountId}`);
    const body = (await screen.json()) as Record<string, unknown>;
    const lists = await requests(from);
    const friends = await friendIds(from);
    const inbox = await noticesAs(from);
    return {
      screenStatus: screen.status,
      relation: body.relation,
      friendCount: body.friendCount,
      sent: lists.sent.length,
      incoming: lists.incoming.length,
      friends: friends.length,
      notices: inbox.notifications.length,
      unread: inbox.unread,
      unseen: inbox.unseen,
    };
  };

  /** The answer to asking again; an error body's request id differs by nature. */
  const askAgain = async (from: Person, to: Person) => {
    const response = await ask(from, to);
    const body = (await response.json()) as { relation?: string; error?: string };
    return { status: response.status, relation: body.relation, error: body.error };
  };

  const worlds = async () => {
    const [left, untouched] = await pair();
    const [declined, refuser] = await pair();
    await ask(left, untouched);
    await ask(declined, refuser);
    expect((await decline(refuser, declined)).status).toBe(204);
    return { left, untouched, declined, refuser };
  };

  for (const [moment, days] of [
    ["on the day", 0],
    ["at day 29", 29],
    ["at day 31", 31],
    ["at day 89", 89],
  ] as const) {
    it(`reads the same ${moment}, on every route`, async () => {
      const { left, untouched, declined, refuser } = await worlds();
      await age(left, untouched, days);
      await age(declined, refuser, days);
      const pending = await seenBy(left, untouched);
      expect(await seenBy(declined, refuser)).toEqual(pending);
      expect(pending.relation).toBe(days < 30 ? "sent" : "none");
      expect(await askAgain(declined, refuser)).toEqual(await askAgain(left, untouched));
    });
  }

  it("reads the same once the sweep has run", async () => {
    const { left, untouched, declined, refuser } = await worlds();
    await age(left, untouched, 31);
    await age(declined, refuser, 31);
    await expireFriendRequests(euEnv(env));
    expect(await seenBy(declined, refuser)).toEqual(await seenBy(left, untouched));
    expect(await askAgain(declined, refuser)).toEqual(await askAgain(left, untouched));
  });

  it("can be taken back alike inside the 30 days, and not after them", async () => {
    const { left, untouched, declined, refuser } = await worlds();
    await age(left, untouched, 29);
    await age(declined, refuser, 29);
    expect((await cancel(declined, refuser)).status).toBe((await cancel(left, untouched)).status);

    const later = await worlds();
    await age(later.left, later.untouched, 31);
    await age(later.declined, later.refuser, 31);
    const expiredCancel = await cancel(later.left, later.untouched);
    expect((await cancel(later.declined, later.refuser)).status).toBe(expiredCancel.status);
  });

  it("is refused in the same words after a decline, an expiry and a cancel", async () => {
    const answers: unknown[] = [];
    for (const end of ["decline", "expire", "cancel"]) {
      const [a, b] = await pair();
      await ask(a, b);
      if (end === "decline") await decline(b, a);
      if (end === "cancel") await cancel(a, b);
      await age(a, b, 31);
      const response = await ask(a, b);
      const { error, title, detail } = (await response.json()) as Record<string, unknown>;
      answers.push({ status: response.status, error, title, detail });
    }
    expect(answers[0]).toMatchObject({ status: 409, error: "request_refused" });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("is free again at day 90, whatever became of it", async () => {
    for (const end of ["decline", "expire", "cancel"]) {
      const [a, b] = await pair();
      await ask(a, b);
      if (end === "decline") await decline(b, a);
      if (end === "cancel") await cancel(a, b);
      await age(a, b, 90);
      expect(await ok(await ask(a, b))).toEqual({ relation: "sent" });
    }
  });
});
