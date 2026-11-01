import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import {
  importPost,
  jobHandlers,
  openImport,
  requestRemoval,
  type SourcePost,
} from "../../../src/modules/imports/index.ts";
import { png } from "../../images.ts";
import { euEnv } from "../../support.ts";
import { ok, person, type Person } from "../../people.ts";
import { befriend, wallPost, type WallPost } from "../social/wall-support.ts";

// The one core every feed delivers to (decisions 0119, 0120). The bug each test
// names: a repeat that duplicates, a date that is lost, a notice or a feed flood
// nobody asked for, something public nobody chose, or a removal that leaves a
// trace or lets a moderated post back in.

const E = euEnv(env);
const SOURCE = "source-a";
type Read = WallPost & { createdAt: number; imported?: boolean; media: unknown[] };
type Page = { posts: Read[] };
const YEARS_AGO = Date.UTC(2019, 4, 17, 12, 30, 45);

const post = (over: Partial<SourcePost> = {}): SourcePost => ({
  id: "s1",
  createdAt: YEARS_AGO,
  body: "Gömul færsla með íslenskum stöfum: þ, ð, æ, ö",
  images: [],
  ...over,
});

const opened = (owner: Person, audience?: "friends" | "everyone") =>
  openImport(E, owner.accountId, { kind: "file", source: SOURCE, audience });

const wall = async (reader: Person, owner: Person) =>
  ok<Page>(await reader.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`));

const homeOf = async (reader: Person) => ok<Page>(await reader.call("GET", "/v1/home"));

const notices = async (accountId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE account_id = ?")
      .bind(accountId)
      .first<{ n: number }>()
  )?.n;

/** Runs the jobs until the queue has nothing due for the removal to do. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { done } = await runJobs(E, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

describe("importing a post", () => {
  it("creates a repeated post once", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const first = await importPost(E, source, post(), "backlog");
    const again = await importPost(E, source, post(), "backlog");
    expect(first.outcome).toBe("imported");
    expect(again).toMatchObject({ outcome: "already", postId: first.postId });
    expect((await wall(owner, owner)).posts).toHaveLength(1);
  });

  it("creates a post once when a second route brings it under another id", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const first = await importPost(E, source, post({ id: "from-a-file" }), "backlog");
    const other = await importPost(
      E,
      source,
      post({ id: "from-a-collector", createdAt: YEARS_AGO + 400, body: `  ${post().body}\n` }),
      "backlog",
    );
    expect(other).toMatchObject({ outcome: "already", postId: first.postId });
    expect((await wall(owner, owner)).posts).toHaveLength(1);
  });

  it("keeps the date and the text, and marks the post as imported", async () => {
    const owner = await person("eigandi");
    await importPost(E, await opened(owner), post(), "backlog");
    const [read] = (await wall(owner, owner)).posts;
    expect(read).toMatchObject({ createdAt: YEARS_AGO, body: post().body, imported: true });
  });

  it("leaves an ordinary post without the mark", async () => {
    const owner = await person("eigandi");
    await wallPost(owner, "friends", "ný");
    const [read] = (await wall(owner, owner)).posts;
    expect(read).not.toHaveProperty("imported");
  });

  it("reads no date ahead of now, which would hold the post at the top of every list", async () => {
    const owner = await person("eigandi");
    const before = Date.now();
    await importPost(
      E,
      await opened(owner),
      post({ createdAt: before + 365 * 86_400_000 }),
      "backlog",
    );
    const [read] = (await wall(owner, owner)).posts;
    expect(read?.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("sends nobody a notice", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const before = await notices(friend.accountId);
    await importPost(E, await opened(owner), post(), "backlog");
    await importPost(E, await opened(owner), post({ id: "s2", body: "önnur" }), "sync");
    await drain();
    expect(await notices(friend.accountId)).toBe(before);
  });

  it("reads only to friends unless the person chose otherwise", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    const stranger = await person("okunnugur");
    await befriend(owner, friend);
    await importPost(E, await opened(owner), post(), "backlog");
    expect((await wall(friend, owner)).posts).toHaveLength(1);
    expect((await wall(stranger, owner)).posts).toHaveLength(0);
  });

  it("reads to everyone when the person chose that on the import", async () => {
    const owner = await person("eigandi");
    const stranger = await person("okunnugur");
    await importPost(E, await opened(owner, "everyone"), post(), "backlog");
    expect((await wall(stranger, owner)).posts).toHaveLength(1);
  });

  it("keeps a backlog out of a friend's home feed, and a sync in it", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const source = await opened(owner);
    const now = Date.now() - 1000;
    await importPost(E, source, post({ id: "old", createdAt: now, body: "úr safni" }), "backlog");
    await importPost(E, source, post({ id: "new", createdAt: now, body: "ný þar" }), "sync");
    const bodies = (await homeOf(friend)).posts.map((p) => p.body);
    expect(bodies).toEqual(["ný þar"]);
  });

  it("imports nothing from a post with neither text nor an image", async () => {
    const owner = await person("eigandi");
    const result = await importPost(E, await opened(owner), post({ body: "  " }), "backlog");
    expect(result.outcome).toBe("empty");
    expect((await wall(owner, owner)).posts).toHaveLength(0);
  });

  it("carries images through the upload and says which it left out", async () => {
    const owner = await person("eigandi");
    const image = await png(2, 2);
    const result = await importPost(
      E,
      await opened(owner),
      post({
        images: [image, new Uint8Array([1, 2, 3]), image, image, image, image].map(
          (bytes) => async () => bytes,
        ),
      }),
      "backlog",
    );
    expect(result.outcome).toBe("imported");
    // Four fit in a post; of the first four one is no image.
    expect(result).toMatchObject({ imagesLeftOut: 3 });
    const [read] = (await wall(owner, owner)).posts;
    expect(read?.media).toHaveLength(3);
  });

  it("does not load the images of a post it already has", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    await importPost(E, source, post(), "backlog");
    let loaded = false;
    await importPost(
      E,
      source,
      post({
        images: [
          async () => {
            loaded = true;
            return await png(2, 2);
          },
        ],
      }),
      "backlog",
    );
    expect(loaded).toBe(false);
  });

  it("keeps a post within the length an imported post has, and says so", async () => {
    const owner = await person("eigandi");
    const result = await importPost(
      E,
      await opened(owner),
      post({ body: "a".repeat(100_001) }),
      "backlog",
    );
    expect(result).toMatchObject({ outcome: "imported", shortened: true });
    const [read] = (await wall(owner, owner)).posts;
    expect(read?.body).toHaveLength(100_000);
  });

  it("finishes a post a run left half done, and leaves one post", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const first = await importPost(E, source, post(), "backlog");
    // The run died after the post was written and before it was marked done,
    // long enough ago that no run still holds it.
    await env.DB.prepare(
      "UPDATE imported_posts SET done_at = NULL, claimed_at = 1 WHERE post_id = ?",
    )
      .bind(first.postId)
      .run();
    const retried = await importPost(E, source, post(), "backlog");
    expect(retried.outcome).toBe("imported");
    expect(retried.postId).not.toBe(first.postId);
    expect((await wall(owner, owner)).posts.map((p) => p.postId)).toEqual([retried.postId]);
  });

  it("refuses a post another run is working on, for that run's retry to settle", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const first = await importPost(E, source, post(), "backlog");
    await env.DB.prepare("UPDATE imported_posts SET done_at = NULL WHERE post_id = ?")
      .bind(first.postId)
      .run();
    await expect(importPost(E, source, post(), "backlog")).rejects.toThrow(/in progress/);
    expect((await wall(owner, owner)).posts).toHaveLength(1);
  });

  it("does not bring back a post its author deleted", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const { postId } = await importPost(E, source, post(), "backlog");
    expect((await owner.call("DELETE", `/v1/posts/${postId}`)).status).toBe(204);
    const again = await importPost(E, source, post(), "backlog");
    expect(again.outcome).toBe("already");
    expect((await wall(owner, owner)).posts).toHaveLength(0);
  });
});

describe("removing an import", () => {
  const count = async (sql: string, ...values: string[]) =>
    (
      await env.DB.prepare(sql)
        .bind(...values)
        .first<{ n: number }>()
    )?.n;

  it("removes the posts, their images and every record of them", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const image = await png(2, 2);
    await importPost(E, source, post({ images: [async () => image] }), "backlog");
    await importPost(E, source, post({ id: "s2", body: "önnur" }), "backlog");
    expect(await requestRemoval(E, owner.accountId, source.importId)).toBe(true);
    await drain();
    expect((await wall(owner, owner)).posts).toHaveLength(0);
    const { accountId } = owner;
    expect(
      await count("SELECT COUNT(*) AS n FROM imported_posts WHERE account_id = ?", accountId),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM import_sources WHERE account_id = ?", accountId),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM social_media WHERE uploader_id = ?", accountId),
    ).toBe(0);
  });

  it("removes more than one job's share", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    for (let i = 0; i < 7; i++) {
      await importPost(E, source, post({ id: `s${i}`, body: `færsla ${i}` }), "backlog");
    }
    await requestRemoval(E, owner.accountId, source.importId, 3);
    await drain();
    expect((await wall(owner, owner)).posts).toHaveLength(0);
  });

  it("leaves the person's other posts alone, and another import's", async () => {
    const owner = await person("eigandi");
    const one = await opened(owner);
    const other = await opened(owner);
    await importPost(E, one, post(), "backlog");
    await importPost(E, other, post({ id: "s2", body: "úr hinu" }), "backlog");
    await wallPost(owner, "friends", "skrifuð hér");
    await requestRemoval(E, owner.accountId, one.importId);
    await drain();
    const bodies = (await wall(owner, owner)).posts.map((p) => p.body).toSorted();
    expect(bodies).toEqual(["skrifuð hér", "úr hinu"]);
  });

  it("lets the person bring it in again by asking again", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    await importPost(E, source, post(), "backlog");
    await requestRemoval(E, owner.accountId, source.importId);
    await drain();
    const again = await importPost(E, await opened(owner), post(), "backlog");
    expect(again.outcome).toBe("imported");
  });

  it("takes nothing more into an import being removed", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    await requestRemoval(E, owner.accountId, source.importId);
    const late = await importPost(E, source, post(), "sync");
    expect(late.outcome).toBe("stopped");
    expect((await wall(owner, owner)).posts).toHaveLength(0);
  });

  it("leaves nothing of a post being written while the removal finished", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const image = await png(2, 2);
    const late = await importPost(
      E,
      source,
      post({
        images: [
          async () => {
            await requestRemoval(E, owner.accountId, source.importId);
            await drain();
            return image;
          },
        ],
      }),
      "backlog",
    );
    expect(late.outcome).toBe("stopped");
    expect((await wall(owner, owner)).posts).toHaveLength(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM social_media WHERE uploader_id = ?", owner.accountId),
    ).toBe(0);
  });

  it("refuses another person's import", async () => {
    const owner = await person("eigandi");
    const other = await person("annar");
    const source = await opened(owner);
    await importPost(E, source, post(), "backlog");
    expect(await requestRemoval(E, other.accountId, source.importId)).toBe(false);
    await drain();
    expect((await wall(owner, owner)).posts).toHaveLength(1);
  });

  it("keeps a post a moderator removed, and does not let it back in", async () => {
    const owner = await person("eigandi");
    const source = await opened(owner);
    const { postId } = await importPost(E, source, post(), "backlog");
    await env.DB.prepare(
      "UPDATE post_index SET state = 'removed', moderated_at = ? WHERE post_id = ?",
    )
      .bind(Date.now(), postId)
      .run();
    await requestRemoval(E, owner.accountId, source.importId);
    await drain();
    const kept = await env.DB.prepare("SELECT state FROM post_index WHERE post_id = ?")
      .bind(postId)
      .first<{ state: string }>();
    expect(kept?.state).toBe("removed");
    const again = await importPost(E, await opened(owner), post(), "backlog");
    expect(again.outcome).toBe("already");
  });
});

describe("the account going", () => {
  it("takes its imports with it", async () => {
    const owner = await person("eigandi");
    await importPost(E, await opened(owner), post(), "backlog");
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(owner.accountId).run();
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM imported_posts WHERE account_id = ?1)
            + (SELECT COUNT(*) FROM import_sources WHERE account_id = ?1) AS n`,
    )
      .bind(owner.accountId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
