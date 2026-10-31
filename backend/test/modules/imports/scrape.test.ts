import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askForCheck,
  createConnection,
  expireUnproven,
  listConnections,
  removeConnection,
} from "../../../src/modules/imports/connections.ts";
import { createApp } from "../../../src/app.ts";
import { mediaBucket } from "../../../src/env/index.ts";
import { expireFiles, publishFile, type Choice } from "../../../src/modules/imports/file.ts";
import { jobHandlers } from "../../../src/modules/imports/index.ts";
import { scrapeHealth, startDueScrapes } from "../../../src/modules/imports/scrape-jobs.ts";
import { profileAddress, scrapeSettings } from "../../../src/modules/imports/scrape.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { png } from "../../images.ts";
import { errorOf, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";

// A connection to a public profile (decision 0120), against a fake provider. The bug
// each test names: someone else's posts coming in, a post coming in twice, a run paid
// for past the cap or with the feed off, an address the Worker should never fetch, or
// a removal that leaves the connection running, or a post the person left out of the
// first collection coming in after all.

const API = "https://provider.example/v2";
const PROFILE = "https://www.source.example/somebody";
const MEDIA = "https://media.source.example";
const AUTHOR = "author-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const POST_USD = 0.01;
const RUN_USD = 0.01;

const config = JSON.stringify({
  api: API,
  actor: "someone~posts",
  sourceHosts: ["source.example"],
  mediaHosts: ["media.source.example"],
  usdPerPost: POST_USD,
  usdPerRun: RUN_USD,
});

const on = (cap = "5"): Env =>
  ({
    ...euEnv(env),
    IMPORT_SCRAPE: "on",
    IMPORT_SCRAPE_TOKEN: "token",
    IMPORT_SCRAPE_CONFIG: config,
    IMPORT_SCRAPE_MONTHLY_USD: cap,
  }) as unknown as Env;

const E = on();
const YEARS_AGO = Date.UTC(2019, 4, 17, 12) / 1000;

type Item = Record<string, unknown>;
const item = (id: string, text: string, over: Item = {}): Item => ({
  postId: id,
  text,
  timestamp: YEARS_AGO,
  user: { id: AUTHOR },
  url: `${PROFILE}/posts/${id}`,
  media: [],
  ...over,
});

/** The provider and the image host, and every address the Worker asked for. */
function fakeProvider(posts: () => Item[], figureUsd = 0) {
  const runs = new Map<string, number>();
  const asked: string[] = [];
  const started: unknown[] = [];
  const image = png(2, 2);
  const answer = (body: unknown) => Response.json(body);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    asked.push(url.href);
    if (url.origin === MEDIA) {
      if (url.pathname.startsWith("/gone")) return new Response(null, { status: 404 });
      return new Response(await image, { headers: { "content-type": "image/png" } });
    }
    if (!url.href.startsWith(API)) throw new Error(`asked for ${url.href}`);
    const path = url.pathname.slice(new URL(API).pathname.length);
    if (init?.method === "POST") {
      const id = `run-${runs.size + 1}`;
      runs.set(id, 0);
      started.push(JSON.parse(String(init.body)));
      return answer({
        data: { id, status: "RUNNING", defaultDatasetId: `set-${id}`, usageTotalUsd: 0 },
      });
    }
    const run = /^\/actor-runs\/(.+)$/.exec(path)?.[1];
    if (run) {
      // Running at the first look, finished at the next.
      const looks = runs.get(run) ?? 0;
      runs.set(run, looks + 1);
      return answer({
        data: {
          id: run,
          status: looks === 0 ? "RUNNING" : "SUCCEEDED",
          defaultDatasetId: `set-${run}`,
          usageTotalUsd: figureUsd,
        },
      });
    }
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    return answer(posts().slice(offset, offset + limit));
  });
  return { asked, started };
}

async function drain(with_: Env = E): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { done } = await runJobs(with_, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

/** Starts what is due, `ahead` milliseconds from now, and runs it through. */
async function tick(with_: Env = E, ahead = 1): Promise<void> {
  await startDueScrapes(with_, Date.now() + ahead);
  await drain(with_);
}

async function connect(owner: Person, audience?: "friends" | "everyone") {
  const made = await createConnection(E, owner.accountId, { profileUrl: PROFILE, audience });
  if (typeof made === "string") throw new Error(made);
  return made;
}

/** A connection whose code has been found and whose first posts wait in the preview. */
async function proven(owner: Person, posts: Item[], audience?: "friends" | "everyone") {
  const connection = await connect(owner, audience);
  const shown = [item("code", `Staðfesting ${connection.code}`), ...posts];
  const fake = fakeProvider(() => shown);
  await askForCheck(E, owner.accountId, connection.importId);
  await tick();
  await tick();
  return { importId: connection.importId, fake, shown };
}

/** Publishes the preview as the person would. */
async function choose(owner: Person, importId: string, choice: Choice = {}) {
  expect(await publishFile(E, owner.accountId, importId, choice)).toBe("ok");
  await drain();
}

/** A connection whose first posts have been chosen and have come in. */
async function imported(owner: Person, posts: Item[], audience?: "friends" | "everyone") {
  const made = await proven(owner, posts, audience);
  await choose(owner, made.importId);
  return made;
}

const stored = async (importId: string) =>
  (await mediaBucket(E).list({ prefix: `imports/${importId}` })).objects.map((o) => o.key);

const wall = async (owner: Person) =>
  (
    await ok<{
      posts: { body: string; createdAt: number; imported?: boolean; media: unknown[] }[];
    }>(await owner.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`))
  ).posts;

const connectionOf = async (owner: Person, importId: string) => {
  const found = (await listConnections(E, owner.accountId)).find((c) => c.importId === importId);
  if (!found) throw new Error("no such connection");
  return found;
};

const spend = async () =>
  (
    await env.DB.prepare("SELECT micros FROM import_scrape_spend WHERE month = ?")
      .bind(new Date().toISOString().slice(0, 7))
      .first<{ micros: number }>()
  )?.micros ?? 0;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM import_scrape_spend").run();
  await env.DB.prepare("DELETE FROM import_connections").run();
});
afterEach(() => vi.unstubAllGlobals());

describe("proving a profile", () => {
  it("brings in nothing when the code is not on the profile", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    const { asked } = fakeProvider(() => [item("a", "Einhver annar skrifaði þetta")]);
    expect(await askForCheck(E, owner.accountId, importId)).toMatchObject({ state: "checking" });
    await tick();
    expect(await connectionOf(owner, importId)).toMatchObject({
      state: "unproven",
      outcome: "not_found",
      posts: 0,
    });
    expect(await wall(owner)).toEqual([]);
    expect(asked.length).toBeGreaterThan(0);
    // Nothing starts again until the person asks.
    await tick(E, DAY_MS);
    const runs = asked.filter((url) => url.endsWith("/runs") || url.includes("/runs?"));
    expect(runs).toHaveLength(1);
  });

  it("shows the code until it is found, and never after", async () => {
    const owner = await person("Sigga");
    const { code } = await connect(owner);
    expect(code).toMatch(/^[0-9A-F]{12}$/);
    const { importId } = await proven(owner, []);
    expect((await connectionOf(owner, importId)).code).toBeNull();
  });

  it("refuses another person's connection", async () => {
    const owner = await person("Sigga");
    const other = await person("Jón");
    const { importId } = await connect(owner);
    expect(await askForCheck(E, other.accountId, importId)).toBe("not_found");
    await askForCheck(E, owner.accountId, importId);
    expect(await removeConnection(E, other.accountId, importId)).toBe("not_found");
    expect(await listConnections(E, other.accountId)).toEqual([]);
    expect((await connectionOf(owner, importId)).state).toBe("checking");
  });

  it("stops at the number of paid checks one connection may ask for", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    fakeProvider(() => []);
    for (let i = 0; i < 10; i++) {
      expect(typeof (await askForCheck(E, owner.accountId, importId))).toBe("object");
      await tick();
    }
    expect(await askForCheck(E, owner.accountId, importId)).toBe("conflict");
  });

  it("refuses a second check while one is out", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    fakeProvider(() => []);
    await askForCheck(E, owner.accountId, importId);
    expect(await askForCheck(E, owner.accountId, importId)).toBe("conflict");
  });

  it("stops at three connections", async () => {
    const owner = await person("Sigga");
    for (let i = 0; i < 3; i++) await connect(owner);
    expect(await createConnection(E, owner.accountId, { profileUrl: PROFILE })).toBe("conflict");
  });

  it("drops a connection never proven after 30 days", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    expect(await expireUnproven(E, Date.now() + 31 * DAY_MS)).toBe(1);
    await expect(connectionOf(owner, importId)).rejects.toThrow("no such connection");
  });
});

describe("importing from a proven profile", () => {
  it("brings the author's posts in under their dates, and only theirs", async () => {
    const owner = await person("Sigga");
    const { importId } = await imported(owner, [
      item("a", "Gömul færsla: þ, ð, æ, ö"),
      item("b", "Einhver annar", { user: { id: "someone-else" } }),
    ]);
    const posts = await wall(owner);
    expect(posts.map((p) => p.body)).toEqual(["Gömul færsla: þ, ð, æ, ö"]);
    expect(posts[0]).toMatchObject({ createdAt: YEARS_AGO * 1000, imported: true });
    expect(await connectionOf(owner, importId)).toMatchObject({
      state: "connected",
      outcome: "ok",
      posts: 1,
    });
  });

  it("leaves out the post that showed the code", async () => {
    const owner = await person("Sigga");
    await proven(owner, []);
    expect(await wall(owner)).toEqual([]);
  });

  it("pins the author, so a code someone else posted brings in only that person's posts", async () => {
    const owner = await person("Sigga");
    const { code, importId } = await connect(owner);
    fakeProvider(() => [
      item("code", `${code}`, { user: { id: "the-one-who-posted-it" } }),
      item("a", "Eigandi prófílsins skrifaði þetta"),
      item("b", "Sá sem setti kóðann", { user: { id: "the-one-who-posted-it" } }),
    ]);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    await tick();
    await choose(owner, importId);
    expect((await wall(owner)).map((p) => p.body)).toEqual(["Sá sem setti kóðann"]);
  });

  it("makes each post once when a run repeats, and asks only for what is new", async () => {
    const owner = await person("Sigga");
    const { fake, importId, shown } = await imported(owner, [item("a", "Fyrsta")]);
    await tick(E, DAY_MS + 1000);
    expect((await wall(owner)).map((p) => p.body)).toEqual(["Fyrsta"]);
    expect(await connectionOf(owner, importId)).toMatchObject({ posts: 1, state: "connected" });
    expect(fake.started.at(-1)).toMatchObject({ onlyPostsNewerThan: expect.any(String) });
    shown.push(item("n", "Ný færsla", { timestamp: (Date.now() + DAY_MS + 5000) / 1000 }));
    await tick(E, 2 * DAY_MS + 2000);
    expect((await wall(owner)).map((p) => p.body).sort()).toEqual(["Fyrsta", "Ný færsla"]);
  });

  it("keeps a post to friends unless the person chose otherwise", async () => {
    const owner = await person("Sigga");
    const reader = await person("Jón");
    await imported(owner, [item("a", "Aðeins vinir")]);
    const seen = await ok<{ posts: unknown[] }>(
      await reader.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`),
    );
    expect(seen.posts).toEqual([]);
  });

  it("shows a post to everyone when the person chose that", async () => {
    const owner = await person("Sigga");
    const reader = await person("Jón");
    await imported(owner, [item("a", "Öllum opið")], "everyone");
    const seen = await ok<{ posts: unknown[] }>(
      await reader.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`),
    );
    expect(seen.posts).toHaveLength(1);
  });

  it("carries an image over and leaves out one that has gone", async () => {
    const owner = await person("Sigga");
    await imported(owner, [
      item("a", "Með myndum", {
        media: [{ photo_image: { uri: `${MEDIA}/here.png` } }, { image: `${MEDIA}/gone.png` }],
      }),
    ]);
    const [post] = await wall(owner);
    expect(post?.media).toHaveLength(1);
  });

  it("never fetches an image from a host outside the list", async () => {
    const owner = await person("Sigga");
    const { fake } = await imported(owner, [
      item("a", "Vond mynd", {
        media: [
          { image: "https://169.254.169.254/latest/meta-data" },
          { image: "http://media.source.example/plain.png" },
          { image: "https://media.source.example.evil.example/x.png" },
          { image: "https://user@media.source.example/x.png" },
        ],
      }),
    ]);
    const [post] = await wall(owner);
    expect(post?.media).toEqual([]);
    expect(fake.asked.filter((url) => !url.startsWith(API))).toEqual([]);
  });

  it("brings a video post's text with a link to the original", async () => {
    const owner = await person("Sigga");
    await imported(owner, [
      item("a", "Myndband", { isVideo: true, media: [{ is_playable: true, thumbnail: "x" }] }),
    ]);
    const [post] = await wall(owner);
    expect(post?.body).toContain("Myndband");
    expect(post?.body).toContain(`${PROFILE}/posts/a`);
    expect(post?.media).toEqual([]);
  });
});

describe("the first collection", () => {
  const photo = { media: [{ image: `${MEDIA}/here.png` }] };
  const noMediaFetched = (asked: string[]) => asked.filter((url) => url.startsWith(MEDIA));

  it("puts nothing on the wall until the person publishes, and shows what it holds", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [
      item("a", "Með mynd", photo),
      item("b", "Myndband", { isVideo: true, media: [{ is_playable: true }] }),
    ]);
    expect(await wall(owner)).toEqual([]);
    expect(await connectionOf(owner, importId)).toMatchObject({ state: "preview", posts: 0 });
    const status = await ok<{ state: string; counts: Record<string, number> }>(
      await owner.call("GET", `/v1/imports/${importId}`),
    );
    expect(status.state).toBe("ready");
    expect(status.counts).toMatchObject({ posts: 2, images: 1, videos: 1 });
    const { items } = await ok<{ items: { id: string; hasVideo: boolean }[] }>(
      await owner.call("GET", `/v1/imports/${importId}/items`),
    );
    expect(items.map((i) => [i.id, i.hasVideo]).sort()).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("starts no daily run while the preview waits", async () => {
    const owner = await person("Sigga");
    const { fake } = await proven(owner, [item("a", "Bíður")]);
    const before = fake.started.length;
    await tick(E, 3 * DAY_MS);
    expect(fake.started).toHaveLength(before);
  });

  it("never brings in a post the person left out, even from a provider that returns all", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [item("a", "Með"), item("b", "Ekki með")]);
    await choose(owner, importId, { excluded: ["b"] });
    expect((await wall(owner)).map((p) => p.body)).toEqual(["Með"]);
    await tick(E, DAY_MS + 1000);
    expect((await wall(owner)).map((p) => p.body)).toEqual(["Með"]);
  });

  it("keeps a post out that was written while the run ran", async () => {
    const owner = await person("Sigga");
    const during = { timestamp: (Date.now() + 60 * 60 * 1000) / 1000 };
    const { importId } = await proven(owner, [item("a", "Með"), item("b", "Nýleg", during)]);
    await choose(owner, importId, { excluded: ["b"] });
    await tick(E, DAY_MS + 1000);
    expect((await wall(owner)).map((p) => p.body)).toEqual(["Með"]);
  });

  it("asks at each run from when the last one began, so a post written during it comes", async () => {
    const owner = await person("Sigga");
    const { importId, shown } = await imported(owner, [item("a", "Fyrsta")]);
    const { lastSyncAt } = await connectionOf(owner, importId);
    expect(lastSyncAt).toBeLessThan(Date.now());
    shown.push(item("n", "Rétt á eftir", { timestamp: (Number(lastSyncAt) + 1) / 1000 }));
    await tick(E, DAY_MS + 1000);
    expect((await wall(owner)).map((p) => p.body).sort()).toEqual(["Fyrsta", "Rétt á eftir"]);
  });

  it("asks each later run from when the one before it began", async () => {
    const owner = await person("Sigga");
    const { fake, importId, shown } = await imported(owner, [item("a", "Fyrsta")]);
    const began = Date.now() + DAY_MS + 1000;
    const { lastSyncAt: first } = await connectionOf(owner, importId);
    await tick(E, DAY_MS + 1000);
    const { lastSyncAt: second } = await connectionOf(owner, importId);
    expect(second).toBeGreaterThan(Number(first));
    shown.push(item("n", "Skrifuð í keyrslunni", { timestamp: (began + 1000) / 1000 }));
    await tick(E, 2 * DAY_MS + 2000);
    expect((await wall(owner)).map((p) => p.body)).toContain("Skrifuð í keyrslunni");
    expect(fake.started.length).toBeGreaterThan(2);
  });

  it("leaves an empty post out of the preview, and keeps a bare video", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [
      item("a", "   "),
      item("b", "", { isVideo: true, media: [{ is_playable: true }] }),
      item("c", "Texti"),
    ]);
    const { items } = await ok<{ items: { id: string }[] }>(
      await owner.call("GET", `/v1/imports/${importId}/items`),
    );
    expect(items.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("publishes a video's link from the preview", async () => {
    const owner = await person("Sigga");
    await imported(owner, [
      item("v", "Myndband", { isVideo: true, media: [{ is_playable: true }] }),
    ]);
    const [post] = await wall(owner);
    expect(post?.body).toContain(`${PROFILE}/posts/v`);
  });

  it("brings a video's link on a later run too", async () => {
    const owner = await person("Sigga");
    const { shown } = await imported(owner, [item("a", "Fyrsta")]);
    shown.push(
      item("v", "Nýtt myndband", {
        isVideo: true,
        media: [{ is_playable: true }],
        timestamp: (Date.now() + DAY_MS + 5000) / 1000,
      }),
    );
    await tick(E, DAY_MS + 1000);
    const posts = await wall(owner);
    expect(posts.find((p) => p.body.startsWith("Nýtt myndband"))?.body).toContain(
      `${PROFILE}/posts/v`,
    );
  });

  it("deletes every page of what an import holds", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [item("a", "Mörg")]);
    const bucket = mediaBucket(E);
    // One more than a listing returns at a time.
    await Promise.all(
      Array.from({ length: 1001 }, (_, at) =>
        bucket.put(`imports/${importId}/many/${at}`, new Uint8Array([1])),
      ),
    );
    expect(await removeConnection(E, owner.accountId, importId)).toBe("ok");
    expect(await stored(importId)).toEqual([]);
  });

  it("refuses to publish a connection that has nothing waiting", async () => {
    const owner = await person("Sigga");
    const { importId } = await imported(owner, [item("a", "Fyrsta")]);
    expect(await publishFile(E, owner.accountId, importId, {})).toBe("conflict");
  });

  it("stops the runs when removed by the file route too", async () => {
    const owner = await person("Sigga");
    const { fake, importId } = await imported(owner, [item("a", "Fyrsta")]);
    const res = await owner.call("DELETE", `/v1/imports/${importId}`);
    expect(res.status).toBe(204);
    const before = fake.started.length;
    await startDueScrapes(E, Date.now() + 3 * DAY_MS);
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM import_connections WHERE import_id = ? AND next_run_at IS NOT NULL",
    )
      .bind(importId)
      .first<{ n: number }>();
    expect(pending?.n ?? 0).toBe(0);
    await drain();
    expect(fake.started).toHaveLength(before);
  });

  it("holds the images itself, so publishing fetches none and keeps none", async () => {
    const owner = await person("Sigga");
    const { fake, importId } = await proven(owner, [item("a", "Með mynd", photo)]);
    expect(noMediaFetched(fake.asked)).toHaveLength(1);
    expect(await stored(importId)).toHaveLength(1);
    await choose(owner, importId);
    expect(noMediaFetched(fake.asked)).toHaveLength(1);
    const [post] = await wall(owner);
    expect(post?.media).toHaveLength(1);
    expect(await stored(importId)).toEqual([]);
  });

  it("drops the images and the rows when the person removes it", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [item("a", "Með mynd", photo)]);
    expect(await removeConnection(E, owner.accountId, importId)).toBe("ok");
    expect(await stored(importId)).toEqual([]);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM import_file_items WHERE import_id = ?",
    )
      .bind(importId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
    await drain();
    expect(await listConnections(E, owner.accountId)).toEqual([]);
  });

  it("removes images a collection stored after the removal was asked for", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [item("a", "Með mynd", photo)]);
    await removeConnection(E, owner.accountId, importId);
    await mediaBucket(E).put(`imports/${importId}/late/0`, new Uint8Array([1]));
    await drain();
    expect(await stored(importId)).toEqual([]);
  });

  it("drops the connection and its images when it waits past its time", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, [item("a", "Með mynd", photo)]);
    await expireFiles(E, Date.now() + 8 * DAY_MS);
    expect(await stored(importId)).toEqual([]);
    expect(await listConnections(E, owner.accountId)).toEqual([]);
  });

  it("goes straight to daily runs when there is nothing to choose from", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, []);
    expect((await connectionOf(owner, importId)).state).toBe("connected");
    expect(
      await env.DB.prepare("SELECT 1 FROM import_files WHERE import_id = ?").bind(importId).first(),
    ).toBeNull();
  });

  it("applies the audience chosen at publishing to the later runs", async () => {
    const owner = await person("Sigga");
    const reader = await person("Jón");
    const { importId, shown } = await proven(owner, [item("a", "Fyrsta")]);
    await choose(owner, importId, { audience: "everyone" });
    shown.push(item("n", "Ný", { timestamp: (Date.now() + DAY_MS + 5000) / 1000 }));
    await tick(E, DAY_MS + 1000);
    const seen = await ok<{ posts: unknown[] }>(
      await reader.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`),
    );
    expect(seen.posts).toHaveLength(2);
  });

  it("publishes later runs without a preview, and goes on after a preview expires mid-publish", async () => {
    const owner = await person("Sigga");
    const { importId, shown } = await imported(owner, [item("a", "Fyrsta")]);
    shown.push(item("n", "Ný", { timestamp: (Date.now() + DAY_MS + 5000) / 1000 }));
    await tick(E, DAY_MS + 1000);
    expect(await wall(owner)).toHaveLength(2);
    expect((await connectionOf(owner, importId)).state).toBe("connected");
    const other = await person("Jón");
    const stuck = await proven(other, [item("c", "Föst")]);
    await env.DB.prepare("UPDATE import_files SET state = 'publishing' WHERE import_id = ?")
      .bind(stuck.importId)
      .run();
    await expireFiles(E, Date.now() + 8 * DAY_MS);
    expect((await connectionOf(other, stuck.importId)).state).toBe("connected");
  });
});

describe("an answer with no posts", () => {
  const nothing = { inputUrl: PROFILE, error: "no_items", errorDescription: "Empty or private" };
  const refused = { inputUrl: PROFILE, error: "blocked", errorDescription: "Try later" };
  const dueAt = async (importId: string) =>
    (
      await env.DB.prepare("SELECT next_run_at AS at FROM import_connections WHERE import_id = ?")
        .bind(importId)
        .first<{ at: number | null }>()
    )?.at ?? null;
  /** A published connection, and a way to change what the provider answers from now on. */
  async function synced(owner: Person) {
    const made = await imported(owner, [item("a", "Fyrsta")]);
    const before = await connectionOf(owner, made.importId);
    const answer = (rows: Item[]) => made.shown.splice(0, made.shown.length, ...rows);
    return { ...made, before, answer };
  }

  it.each([
    ["says it found nothing", [nothing]],
    ["holds no rows", []],
  ])("keeps the last good date when the provider %s, and tries tomorrow", async (_name, rows) => {
    const owner = await person("Sigga");
    const { importId, before, answer } = await synced(owner);
    answer(rows);
    await tick(E, DAY_MS + 1000);
    const after = await connectionOf(owner, importId);
    expect(after).toMatchObject({ state: "connected", outcome: "ok" });
    expect(after.lastSyncAt).toBe(before.lastSyncAt);
    expect(await dueAt(importId)).toBeGreaterThan(Date.now() + DAY_MS / 2);
  });

  it("brings in what was written during a spell the provider answered nothing", async () => {
    const owner = await person("Sigga");
    const { importId, before, answer, fake } = await synced(owner);
    answer([nothing]);
    await tick(E, DAY_MS + 1000);
    // Before the run that answered nothing began, which a moved date would pass over.
    const written = Number(before.lastSyncAt) + 1;
    answer([item("n", "Skrifuð á meðan", { timestamp: written / 1000 })]);
    await env.DB.prepare("UPDATE import_connections SET next_run_at = 1 WHERE import_id = ?")
      .bind(importId)
      .run();
    await tick();
    expect((await wall(owner)).map((p) => p.body)).toContain("Skrifuð á meðan");
    const asked = fake.started.at(-1) as { onlyPostsNewerThan: string };
    expect(asked.onlyPostsNewerThan).toBe(
      new Date(Number(before.lastSyncAt)).toISOString().slice(0, 10),
    );
    expect((await connectionOf(owner, importId)).lastSyncAt).toBeGreaterThan(
      Number(before.lastSyncAt),
    );
  });

  it.each([
    ["an error of another kind", [refused]],
    ["rows it cannot read", [{ something: "else" }]],
    ["an error beside the one for nothing", [nothing, refused]],
  ])("counts %s as failed and tries again within the hour", async (_name, rows) => {
    const owner = await person("Sigga");
    const { importId, before, answer } = await synced(owner);
    answer(rows);
    await tick(E, DAY_MS + 1000);
    const after = await connectionOf(owner, importId);
    expect(after).toMatchObject({ state: "connected", outcome: "failed" });
    expect(after.lastSyncAt).toBe(before.lastSyncAt);
    expect(await dueAt(importId)).toBeLessThan(Date.now() + 2 * 60 * 60 * 1000);
  });

  it("counts an answer that is not a list as failed", async () => {
    const owner = await person("Sigga");
    const { importId, before } = await synced(owner);
    const provider = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      new Request(input, init).url.includes("/datasets/")
        ? Response.json({ data: "something else" })
        : provider(input, init),
    );
    await tick(E, DAY_MS + 1000);
    const after = await connectionOf(owner, importId);
    expect(after.outcome).toBe("failed");
    expect(after.lastSyncAt).toBe(before.lastSyncAt);
  });

  it("treats posts by someone else as an answer", async () => {
    const owner = await person("Sigga");
    const { importId, before, answer } = await synced(owner);
    answer([item("x", "Annar skrifaði", { user: { id: "someone-else" } })]);
    await tick(E, DAY_MS + 1000);
    const after = await connectionOf(owner, importId);
    expect(after.outcome).toBe("ok");
    expect(after.lastSyncAt).toBeGreaterThan(Number(before.lastSyncAt));
  });

  it.each([
    ["says it found nothing", [nothing]],
    ["errs", [refused]],
    ["holds no rows", []],
  ])(
    "does not count the first collection done when the provider %s, and waits for the person",
    async (_name, rows) => {
      const owner = await person("Sigga");
      const connection = await connect(owner);
      const shown: Item[] = [item("code", `Staðfesting ${connection.code}`)];
      const fake = fakeProvider(() => shown);
      await askForCheck(E, owner.accountId, connection.importId);
      await tick();
      expect((await connectionOf(owner, connection.importId)).state).toBe("importing");
      shown.splice(0, 1, ...rows);
      await tick();
      expect(await connectionOf(owner, connection.importId)).toMatchObject({
        state: "unproven",
        outcome: "failed",
        code: connection.code,
        lastSyncAt: null,
      });
      expect(await dueAt(connection.importId)).toBeNull();
      const files = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM import_files WHERE import_id = ?",
      )
        .bind(connection.importId)
        .first<{ n: number }>();
      expect(files?.n).toBe(0);
      const started = fake.started.length;
      await tick(E, DAY_MS);
      expect(fake.started).toHaveLength(started);

      // Asking again goes the whole way, and the file of the failed try does not stand in the way.
      shown.splice(
        0,
        shown.length,
        item("code", `Staðfesting ${connection.code}`),
        item("a", "Gamalt"),
      );
      expect(await askForCheck(E, owner.accountId, connection.importId)).toMatchObject({
        state: "checking",
      });
      await tick();
      await tick();
      expect((await connectionOf(owner, connection.importId)).state).toBe("preview");
    },
  );

  // A full part is followed by a read past the end, which holds no rows.
  const fullPart = (prefix: string) =>
    Array.from({ length: 10 }, (_, at) => item(`${prefix}${at}`, `Færsla ${at}`));

  it("does not read the empty end of a full answer as a daily run with nothing", async () => {
    const owner = await person("Sigga");
    const { importId, before, answer } = await synced(owner);
    answer(fullPart("n"));
    await tick(E, DAY_MS + 1000);
    const after = await connectionOf(owner, importId);
    expect(after.outcome).toBe("ok");
    expect(after.lastSyncAt).toBeGreaterThan(Number(before.lastSyncAt));
  });

  it("does not read the empty end of a full answer as a failed first collection", async () => {
    const owner = await person("Sigga");
    const { importId, code } = await connect(owner);
    fakeProvider(() => [item("code", `Staðfesting ${code}`), ...fullPart("a").slice(1)]);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    await tick();
    expect((await connectionOf(owner, importId)).state).toBe("preview");
  });

  it("tells a provider's error from a code not found when checking", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    const shown: Item[] = [refused];
    fakeProvider(() => shown);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    expect(await connectionOf(owner, importId)).toMatchObject({
      state: "unproven",
      outcome: "failed",
    });
    shown.splice(0, 1, nothing);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    expect((await connectionOf(owner, importId)).outcome).toBe("not_found");
  });
});

describe("addresses", () => {
  const settings = () => {
    const made = scrapeSettings(E);
    if (!made) throw new Error("no settings");
    return made;
  };

  it("takes a profile and keeps only what names it", () => {
    expect(profileAddress(settings(), ` ${PROFILE}?ref=x#y `)).toBe(PROFILE);
    expect(profileAddress(settings(), `https://www.source.example/profile.php?id=7&ref=x`)).toBe(
      "https://www.source.example/profile.php?id=7",
    );
  });

  it.each([
    "https://evil.example/somebody",
    "https://source.example.evil.example/somebody",
    "http://www.source.example/somebody",
    "https://www.source.example/",
    "https://user:pw@www.source.example/somebody",
    "https://www.source.example:8443/somebody",
    "not an address",
  ])("refuses %s", async (profileUrl) => {
    expect(profileAddress(settings(), profileUrl)).toBeNull();
    const owner = await person("Sigga");
    expect(await createConnection(E, owner.accountId, { profileUrl })).toBe("invalid_request");
  });
});

describe("the off switch", () => {
  const off = { ...E, IMPORT_SCRAPE: "off" } as Env;

  it("refuses a new connection and a check, over the API too", async () => {
    const owner = await person("Sigga");
    expect(await createConnection(off, owner.accountId, { profileUrl: PROFILE })).toBe(
      "unavailable",
    );
    const { importId } = await connect(owner);
    expect(await askForCheck(off, owner.accountId, importId)).toBe("unavailable");
    const refused = await owner.call("POST", "/v1/imports/connections", { profileUrl: PROFILE });
    expect(refused.status).toBe(503);
    expect(await errorOf(refused)).toBe("unavailable");
  });

  it("says so in the list, as on says the opposite", async () => {
    const owner = await person("Sigga");
    const list = async (running: Env) =>
      (await (
        await createApp().fetch(
          new Request("https://spjall.test/v1/imports/connections", {
            headers: {
              ...owner.auth,
              [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}`,
            },
          }),
          running,
        )
      ).json()) as { available: boolean };
    expect((await list(off)).available).toBe(false);
    expect((await list(E)).available).toBe(true);
  });

  it("starts no run, and a connection picks up when it comes back on", async () => {
    const owner = await person("Sigga");
    const { fake, importId } = await imported(owner, [item("a", "Fyrsta")]);
    const before = fake.asked.length;
    await tick(off, DAY_MS + 1000);
    expect(fake.asked.length).toBe(before);
    await tick(E, DAY_MS + 1000);
    expect(fake.asked.length).toBeGreaterThan(before);
    expect((await connectionOf(owner, importId)).state).toBe("connected");
  });

  it("is off when a setting is missing or the config is not valid", () => {
    expect(scrapeSettings({ ...E, IMPORT_SCRAPE_TOKEN: "" } as Env)).toBeNull();
    expect(scrapeSettings({ ...E, IMPORT_SCRAPE_CONFIG: "{" } as Env)).toBeNull();
    expect(scrapeSettings({ ...E, IMPORT_SCRAPE_CONFIG: "{}" } as Env)).toBeNull();
  });
});

describe("the monthly cap", () => {
  it("starts no run past it, and says so", async () => {
    // Less than one check of five posts: 0.01 + 5 × 0.01.
    const capped = on("0.05");
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    const { asked } = fakeProvider(() => []);
    await askForCheck(capped, owner.accountId, importId);
    await tick(capped);
    expect(asked).toEqual([]);
    expect(await connectionOf(owner, importId)).toMatchObject({ outcome: "capped" });
    expect(await spend()).toBe(0);
    expect((await scrapeHealth(capped))?.capped).toBe(true);
  });

  it("holds a run's ceiling while the provider reports nothing", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    fakeProvider(() => [], 0);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    expect(await spend()).toBe(60_000);
  });

  it("replaces the ceiling with the provider's figure once it comes through", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    fakeProvider(() => [], 0.002);
    await askForCheck(E, owner.accountId, importId);
    await tick();
    expect(await spend()).toBe(2000);
    expect((await scrapeHealth(E))?.spentMicros).toBe(2000);
    expect((await scrapeHealth(E))?.capped).toBe(false);
  });

  it("gives the ceiling back when a run never started", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await askForCheck(E, owner.accountId, importId);
    await tick();
    expect(await spend()).toBe(0);
    expect(await connectionOf(owner, importId)).toMatchObject({
      state: "unproven",
      outcome: "failed",
    });
  });

  it("reports nothing while the feed is off", async () => {
    expect(await scrapeHealth({ ...E, IMPORT_SCRAPE: "off" } as Env)).toBeNull();
  });
});

describe("recovery", () => {
  it("writes off a run whose jobs gave up, and tries a proven one again", async () => {
    const owner = await person("Sigga");
    const { importId } = await proven(owner, []);
    const at = Date.now();
    await env.DB.prepare(
      "UPDATE import_connections SET run_id = 'dead', run_started_at = ?, next_run_at = NULL WHERE import_id = ?",
    )
      .bind(at - 7 * 60 * 60 * 1000, importId)
      .run();
    await startDueScrapes(E, at);
    const row = await env.DB.prepare(
      "SELECT run_id AS runId, outcome, next_run_at AS nextRunAt FROM import_connections WHERE import_id = ?",
    )
      .bind(importId)
      .first<{ runId: string | null; outcome: string; nextRunAt: number }>();
    expect(row).toMatchObject({ runId: null, outcome: "failed" });
    expect(row?.nextRunAt).toBeGreaterThan(at);
  });

  it("does not let a run written off end the one that came after it", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    fakeProvider(() => []);
    await askForCheck(E, owner.accountId, importId);
    await startDueScrapes(E, Date.now() + 1);
    await runJobs(E, jobHandlers(), Date.now() + 1);
    await env.DB.prepare("UPDATE import_connections SET run_id = 'newer' WHERE import_id = ?")
      .bind(importId)
      .run();
    await drain();
    const row = await env.DB.prepare(
      "SELECT run_id AS runId, outcome FROM import_connections WHERE import_id = ?",
    )
      .bind(importId)
      .first<{ runId: string | null; outcome: string | null }>();
    expect(row).toEqual({ runId: "newer", outcome: null });
  });

  it("takes back a claim whose run was never stored", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    const at = Date.now();
    await env.DB.prepare(
      "UPDATE import_connections SET run_started_at = ?, next_run_at = NULL WHERE import_id = ?",
    )
      .bind(at - 31 * 60 * 1000, importId)
      .run();
    const { started } = fakeProvider(() => []);
    await tick();
    expect(started).toHaveLength(1);
  });
});

describe("removing a connection", () => {
  it("removes what it brought in and starts no more runs", async () => {
    const owner = await person("Sigga");
    const { fake, importId } = await imported(owner, [item("a", "Fyrsta")]);
    expect(await wall(owner)).toHaveLength(1);
    expect(await removeConnection(E, owner.accountId, importId)).toBe("ok");
    expect(await listConnections(E, owner.accountId)).toEqual([]);
    const held = await env.DB.prepare(
      "SELECT next_run_at AS nextRunAt FROM import_connections WHERE import_id = ?",
    )
      .bind(importId)
      .first<{ nextRunAt: number | null }>();
    expect(held?.nextRunAt).toBeNull();
    await drain();
    expect(await wall(owner)).toEqual([]);
    const before = fake.asked.length;
    await tick(E, DAY_MS + 1000);
    expect(fake.asked.length).toBe(before);
    expect(
      await env.DB.prepare("SELECT 1 FROM import_connections WHERE import_id = ?")
        .bind(importId)
        .first(),
    ).toBeNull();
  });

  it("ignores a run still out at the provider", async () => {
    const owner = await person("Sigga");
    const { importId } = await connect(owner);
    const { asked } = fakeProvider(() => [item("a", "Of seint")]);
    await askForCheck(E, owner.accountId, importId);
    await startDueScrapes(E, Date.now() + 1);
    await runJobs(E, jobHandlers(), Date.now() + 1);
    await removeConnection(E, owner.accountId, importId);
    const before = asked.length;
    await drain();
    expect(asked.length).toBe(before);
    expect(await wall(owner)).toEqual([]);
  });
});
