import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../src/compose/account-deletion.ts";
import { space } from "../src/env/index.ts";
import { community, errorOf, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// Polls (decision 0090): a vote is counted and never shown. Every test that
// reads a response goes through `seen`, which keeps the raw text, so the leak
// test can search everything that was ever answered.

type Poll = {
  options: { optionId: string; text: string; votes: number | null }[];
  total: number;
  mine: string | null;
  closed: boolean;
};
type PollPost = { postId: string; body: string; poll?: Poll };

const answered: string[] = [];

/** The body of a 200 answer, recorded for the leak test. */
async function seen<T>(response: Response): Promise<T> {
  const text = await response.clone().text();
  answered.push(text);
  return ok<T>(response);
}

const options = (n: number) => Array.from({ length: n }, (_, i) => `Valkostur ${i + 1}`);

const create = (
  by: Person,
  communityId: string,
  body: string,
  poll: unknown,
  media: string[] = [],
) => by.call("POST", `/v1/communities/${communityId}/posts`, { body, media, poll });

const poll = async (by: Person, communityId: string, n = 3) =>
  seen<PollPost>(await create(by, communityId, "Hvenær hittumst við?", { options: options(n) }));

const vote = (by: Person, postId: string, optionId: string) =>
  by.call("PUT", `/v1/posts/${postId}/vote`, { optionId });
const withdraw = (by: Person, postId: string) => by.call("DELETE", `/v1/posts/${postId}/vote`);
const close = (by: Person, postId: string) => by.call("POST", `/v1/posts/${postId}/poll/close`);
const get = async (by: Person, postId: string) =>
  seen<PollPost>(await by.call("GET", `/v1/posts/${postId}`));

const votesOf = (p: PollPost) => p.poll?.options.map((o) => o.votes);

async function scene() {
  const [owner, moderator, author, voter, other] = [
    await person("Eigandi"),
    await person("Umsjónarmaður"),
    await person("Höfundur"),
    await person("Kjósandi"),
    await person("Annar"),
  ];
  const id = await community(owner, "open", moderator, author, voter, other);
  await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
    role: "moderator",
  });
  return { owner, moderator, author, voter, other, id };
}

const rows = (communityId: string, query: string) =>
  runInDurableObject(
    space(euEnv(env), communityId),
    (_, state) => state.storage.sql.exec<{ n: number }>(query).one().n,
  );

describe("creating a poll", () => {
  it("takes two to six options of up to 80 characters, and no image", async () => {
    const { author, id } = await scene();
    for (const n of [2, 6]) {
      const made = await seen<PollPost>(
        await create(author, id, "Spurning", { options: options(n) }),
      );
      expect(made.poll?.options).toHaveLength(n);
      expect(made.poll).toMatchObject({ total: 0, mine: null, closed: false });
      expect(votesOf(made)).toEqual(Array(n).fill(0));
    }
    const refused = [
      await create(author, id, "Spurning", { options: options(1) }),
      await create(author, id, "Spurning", { options: options(7) }),
      await create(author, id, "Spurning", { options: ["a".repeat(81), "b"] }),
      await create(author, id, "Spurning", { options: ["a", "A"] }),
      await create(author, id, "Spurning", { options: ["", "b"] }),
      await create(author, id, "", { options: options(2) }),
    ];
    for (const r of refused) expect(await errorOf(r)).toBe("invalid_request");
    // 80 characters are fine, and a poll with an image is refused.
    expect((await create(author, id, "Spurning", { options: ["a".repeat(80), "b"] })).status).toBe(
      200,
    );
    const withMedia = await create(author, id, "Spurning", { options: options(2) }, ["sm_x"]);
    expect(withMedia.status).toBe(400);
  });
});

describe("voting", () => {
  it("is set, changed and withdrawn, and the results show only after voting", async () => {
    const { author, voter, other, id } = await scene();
    const made = await poll(author, id);
    const [a, b] = made.poll!.options;

    // Before voting: the options and the total, no counts.
    const before = await get(voter, made.postId);
    expect(votesOf(before)).toEqual([null, null, null]);
    expect(before.poll).toMatchObject({ total: 0, mine: null });

    const voted = await seen<PollPost>(await vote(voter, made.postId, a!.optionId));
    expect(votesOf(voted)).toEqual([1, 0, 0]);
    expect(voted.poll).toMatchObject({ total: 1, mine: a!.optionId });
    // Another reader who has not voted sees the total, never the counts.
    const stranger = await get(other, made.postId);
    expect(votesOf(stranger)).toEqual([null, null, null]);
    expect(stranger.poll).toMatchObject({ total: 1, mine: null });

    const changed = await seen<PollPost>(await vote(voter, made.postId, b!.optionId));
    expect(votesOf(changed)).toEqual([0, 1, 0]);
    expect(changed.poll?.mine).toBe(b!.optionId);

    const gone = await seen<PollPost>(await withdraw(voter, made.postId));
    expect(votesOf(gone)).toEqual([null, null, null]);
    expect(gone.poll).toMatchObject({ total: 0, mine: null });
    // Withdrawing again changes nothing.
    expect((await withdraw(voter, made.postId)).status).toBe(200);
  });

  it("shows the counts at once to the author, the owner and a moderator", async () => {
    const { owner, moderator, author, voter, id } = await scene();
    const made = await poll(author, id);
    await vote(voter, made.postId, made.poll!.options[2]!.optionId);
    for (const reader of [author, owner, moderator]) {
      expect(votesOf(await get(reader, made.postId))).toEqual([0, 0, 1]);
    }
    const feed = await seen<{ posts: PollPost[] }>(await voter.call("GET", "/v1/feed"));
    expect(votesOf(feed.posts[0]!)).toEqual([0, 0, 1]);
  });

  it("refuses an unknown option, a post that is no poll and a reader who may not comment", async () => {
    const { author, voter, id } = await scene();
    const made = await poll(author, id);
    expect((await vote(voter, made.postId, "o9")).status).toBe(400);
    const plain = await seen<PollPost>(
      await author.call("POST", `/v1/communities/${id}/posts`, { body: "Texti" }),
    );
    expect((await vote(voter, plain.postId, "o0")).status).toBe(404);
    expect((await close(author, plain.postId)).status).toBe(404);
    const outsider = await person("Utangarðs");
    expect((await vote(outsider, made.postId, "o0")).status).toBe(403);
  });
});

describe("closing", () => {
  it("is done by the author or a moderator, refused for a member, and shows results to all", async () => {
    const { owner, moderator, author, voter, other, id } = await scene();
    const mine = await poll(author, id);
    await vote(voter, mine.postId, "o1");
    expect((await close(other, mine.postId)).status).toBe(403);
    expect((await close(voter, mine.postId)).status).toBe(403);

    const closed = await seen<PollPost>(await close(author, mine.postId));
    expect(closed.poll?.closed).toBe(true);
    // A reader who never voted sees the final results.
    expect(votesOf(await get(other, mine.postId))).toEqual([0, 1, 0]);
    expect(await errorOf(await vote(other, mine.postId, "o0"))).toBe("poll_closed");
    expect(await errorOf(await withdraw(voter, mine.postId))).toBe("poll_closed");
    // Closing again changes nothing.
    expect((await close(author, mine.postId)).status).toBe(200);

    const second = await poll(author, id);
    expect((await seen<PollPost>(await close(moderator, second.postId))).poll?.closed).toBe(true);
    const third = await poll(author, id);
    expect((await close(owner, third.postId)).status).toBe(200);

    const log = await seen<{ entries: { action: string; target: { id: string } }[] }>(
      await owner.call("GET", `/v1/communities/${id}/moderation-log`),
    );
    // A moderator's closes are logged once each; the author's own is no moderation.
    expect(
      log.entries
        .filter((e) => e.action === "close_poll")
        .map((e) => e.target.id)
        .sort(),
    ).toEqual([second.postId, third.postId].sort());
  });
});

describe("storage", () => {
  it("deletes votes with the post and with the account", async () => {
    const { author, voter, other, id } = await scene();
    const gone = await poll(author, id);
    const kept = await poll(author, id);
    for (const p of [gone, kept]) {
      await vote(voter, p.postId, "o0");
      await vote(other, p.postId, "o1");
    }
    expect(await rows(id, "SELECT COUNT(*) AS n FROM poll_votes")).toBe(4);
    await author.call("DELETE", `/v1/posts/${gone.postId}`);
    expect(await rows(id, "SELECT COUNT(*) AS n FROM poll_votes")).toBe(2);
    expect(await rows(id, "SELECT COUNT(*) AS n FROM poll_options")).toBe(3);

    await deleteAccount(euEnv(env), voter.accountId);
    expect(await rows(id, "SELECT COUNT(*) AS n FROM poll_votes")).toBe(1);
    expect(votesOf(await get(author, kept.postId))).toEqual([0, 1, 0]);
    expect((await get(author, kept.postId)).poll?.total).toBe(1);

    await deleteAccount(euEnv(env), author.accountId);
    for (const t of ["poll_votes", "poll_options", "poll_closed"]) {
      expect(await rows(id, `SELECT COUNT(*) AS n FROM ${t}`)).toBe(0);
    }
  });
});

describe("privacy", () => {
  it("never puts a voter's account id into anyone else's answer, or sends a notice", async () => {
    answered.length = 0;
    const { owner, moderator, author, voter, other, id } = await scene();
    const made = await poll(author, id);
    const before = answered.length;
    await vote(voter, made.postId, "o0");
    await seen(await vote(voter, made.postId, "o2"));
    await vote(other, made.postId, "o2");
    for (const reader of [author, owner, moderator, other]) {
      await get(reader, made.postId);
      await seen(await reader.call("GET", `/v1/communities/${id}/posts`));
      await seen(await reader.call("GET", "/v1/feed"));
    }
    await close(moderator, made.postId);
    for (const reader of [author, owner, moderator, other]) {
      await get(reader, made.postId);
      await seen(await reader.call("GET", `/v1/communities/${id}/posts`));
    }
    await seen(await owner.call("GET", `/v1/communities/${id}/moderation-log`));
    await seen(await author.call("GET", `/v1/posts/${made.postId}/comments`));
    await seen(await author.call("GET", `/v1/notifications`));
    // The voter's own votes were answered to the voter; everything after
    // `before` that is not the voter's own answer must be free of the id.
    const everything = answered.slice(before).join("\n");
    expect(everything).not.toContain(voter.accountId);
    expect(everything).not.toContain(other.accountId);
    // A vote enqueues no notice: no job names either voter.
    const jobs = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jobs WHERE instr(payload, ?1) > 0 OR instr(payload, ?2) > 0",
    )
      .bind(voter.accountId, other.accountId)
      .first<{ n: number }>();
    expect(jobs?.n).toBe(0);
  });
});
