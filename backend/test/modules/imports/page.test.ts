import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.ts";
import { browserSession, newBrowserSession } from "../../../src/identity/sessions.ts";
import { createConnection } from "../../../src/modules/imports/connections.ts";
import { publishFile, SYNC_AFTER_MS } from "../../../src/modules/imports/file.ts";
import { openHeld } from "../../../src/modules/imports/held.ts";
import { jobHandlers } from "../../../src/modules/imports/index.ts";
import { startDuePages } from "../../../src/modules/imports/page-jobs.ts";
import {
  connectPage,
  expirePageOffers,
  listPages,
  removePage,
} from "../../../src/modules/imports/pages.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { png } from "../../images.ts";
import { ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";

// A connection to a page a person manages (decision 0120), against a fake platform. The
// bug each test names: a page the person does not run coming in, a visitor's post coming
// in, a post coming in twice or back after being left out, a token reaching a log or an
// answer, a removal that leaves the token or the runs, or the feed running while off.

const BASE = "https://spjall.test";
const API = "https://platform.example/v1";
const MEDIA = "https://media.platform.example";
const PAGE = "100";
const LONG = "long-token-value";
const PAGE_TOKEN = "page-token-value";
const OTHER_TOKEN = "other-page-token-value";
const SECRET = "app-secret-value";
const HOUR_MS = 60 * 60 * 1000;

const config = {
  authorizeUrl: "https://platform.example/dialog",
  api: API,
  appId: "app-1",
  scopes: ["pages_read"],
  exchangeGrant: "exchange_token",
  sourceHosts: ["platform.example"],
  mediaHosts: ["media.platform.example"],
};

const E = {
  ...euEnv(env),
  IMPORT_PAGE: "on",
  IMPORT_PAGE_CONFIG: JSON.stringify(config),
  IMPORT_PAGE_APP_SECRET: SECRET,
  IMPORT_PAGE_KEY: "k".repeat(32),
} as unknown as Env;

type Post = Record<string, unknown>;
const longAgo = "2019-05-17T12:00:00+0000";
const post = (id: string, message: string, over: Post = {}): Post => ({
  id: `${PAGE}_${id}`,
  message,
  created_time: longAgo,
  permalink_url: `https://www.platform.example/${PAGE}/posts/${id}`,
  from: { id: PAGE },
  ...over,
});

type Fake = {
  posts: Post[];
  /** The token the platform accepts for reading posts. */
  accepted: string;
  /** Answer the posts with a server error. */
  broken: boolean;
  pages: Record<string, unknown>[];
  asked: string[];
  forms: string[];
};

function fakePlatform(posts: Post[] = []): Fake {
  const fake: Fake = {
    posts,
    accepted: PAGE_TOKEN,
    broken: false,
    pages: [
      { id: PAGE, name: "Own page", access_token: PAGE_TOKEN, tasks: ["MANAGE", "CREATE_CONTENT"] },
      { id: "200", name: "Moderated page", access_token: OTHER_TOKEN, tasks: ["MODERATE"] },
    ],
    asked: [],
    forms: [],
  };
  const image = png(2, 2);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    fake.asked.push(url.href);
    if (url.origin === MEDIA) {
      return new Response(await image, { headers: { "content-type": "image/png" } });
    }
    if (!url.href.startsWith(API)) throw new Error(`asked for ${url.href}`);
    const path = url.pathname.slice(new URL(API).pathname.length);
    if (path === "/oauth/access_token") {
      const form = new TextDecoder().decode(await request.arrayBuffer());
      fake.forms.push(form);
      return Response.json({
        access_token: new URLSearchParams(form).has("code") ? "short-token-value" : LONG,
      });
    }
    const bearer = request.headers.get("authorization");
    if (path === "/me/accounts") {
      expect(bearer).toBe(`Bearer ${LONG}`);
      return Response.json({ data: fake.pages });
    }
    if (fake.broken) return Response.json({ error: { code: 2 } }, { status: 500 });
    if (bearer !== `Bearer ${fake.accepted}`) {
      return Response.json({ error: { code: 190 } }, { status: 400 });
    }
    const from = Number(url.searchParams.get("after") ?? 0);
    const limit = Number(url.searchParams.get("limit"));
    const more = from + limit < fake.posts.length;
    return Response.json({
      data: fake.posts.slice(from, from + limit),
      paging: {
        cursors: { after: String(from + limit) },
        ...(more ? { next: "https://platform.example/more" } : {}),
      },
    });
  });
  return fake;
}

const app = (path: string, cookie?: string, on: Env = E) =>
  createApp().fetch(
    new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" }),
    on,
  );

const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0];

async function browser(owner: Person) {
  const session = await newBrowserSession();
  await browserSession(
    E,
    { ...session, browser: null, os: null },
    owner.accountId,
    Date.now(),
  ).run();
  return `__Host-session=${session.secret}`;
}

/** Walks the sign-in at the platform; where the browser ends up. */
async function signIn(owner: Person) {
  const session = await browser(owner);
  const started = await app("/auth/page/start", session);
  expect(started.status).toBe(302);
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
  const flow = cookieOf(started, "__Host-page-flow");
  const back = await app(`/auth/page/callback?code=the-code&state=${state}`, `${session}; ${flow}`);
  return back.headers.get("location");
}

async function connected(owner: Person, posts: Post[] = []) {
  const fake = fakePlatform(posts);
  await signIn(owner);
  const made = await connectPage(E, owner.accountId, { pageId: PAGE });
  if (typeof made === "string") throw new Error(made);
  return { fake, importId: made.importId };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { done } = await runJobs(E, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

async function tick(ahead = 1): Promise<void> {
  await startDuePages(E, Date.now() + ahead);
  await drain();
}

const wall = async (owner: Person) =>
  (
    await ok<{ posts: { body: string }[] }>(
      await owner.call("GET", `/v1/accounts/${owner.accountId}/wall/posts`),
    )
  ).posts.map((p) => p.body);

const row = (importId: string) =>
  env.DB.prepare(
    `SELECT token, phase, next_run_at AS nextRunAt, outcome
       FROM import_page_connections WHERE import_id = ?`,
  )
    .bind(importId)
    .first<{ token: string; phase: string; nextRunAt: number | null; outcome: string | null }>();

/** Tests share one database: only this connection may run, so a read is this one's. */
const onlyThis = (importId: string) =>
  env.DB.prepare("UPDATE import_page_connections SET next_run_at = NULL WHERE import_id != ?")
    .bind(importId)
    .run();

const connectionOf = async (owner: Person, importId: string) => {
  const found = (await listPages(E, owner.accountId)).connections.find(
    (c) => c.importId === importId,
  );
  if (!found) throw new Error("no such connection");
  return found;
};

/** A connection whose first posts were chosen and came in; it now runs daily. */
async function syncing(owner: Person, posts: Post[], leftOut: string[] = []) {
  const made = await connected(owner, posts);
  await tick();
  expect(
    await publishFile(E, owner.accountId, made.importId, {
      excluded: leftOut,
    }),
  ).toBe("ok");
  await drain();
  await openHeld(E, owner.accountId, made.importId, { audience: "friends" });
  return made;
}

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noTokenAnywhere = (text: string) => {
  for (const value of [PAGE_TOKEN, OTHER_TOKEN, LONG, "short-token-value", SECRET, "the-code"]) {
    expect(text).not.toContain(value);
  }
};

describe("while switched off", () => {
  it("offers nothing, refuses to start and reads nothing", async () => {
    const owner = await person("Slökkt");
    const fake = fakePlatform([post("1", "Ekki lesið")]);
    const off = euEnv(env) as unknown as Env;
    expect((await listPages(off, owner.accountId)).available).toBe(false);
    expect((await app("/auth/page/start", await browser(owner), off)).status).toBe(503);
    expect(await connectPage(off, owner.accountId, { pageId: PAGE })).toBe("unavailable");
    await startDuePages(off);
    await runJobs(off, jobHandlers(), Date.now() + 1);
    expect(fake.asked).toEqual([]);
  });

  it("stops a connection's runs when switched off after it was made", async () => {
    const owner = await person("Slökkt síðar");
    const { fake, importId } = await connected(owner, [post("1", "Ekki lesið")]);
    fake.asked.length = 0;
    const off = euEnv(env) as unknown as Env;
    await startDuePages(off, Date.now() + 1);
    await runJobs(off, jobHandlers(), Date.now() + 1);
    expect(fake.asked).toEqual([]);
    expect((await row(importId))?.phase).toBe("backlog");
  });
});

describe("signing in at the platform", () => {
  it("offers only the pages the person manages, with no token in any answer", async () => {
    const owner = await person("Stjórnandi");
    const fake = fakePlatform();
    expect(await signIn(owner)).toBe("/imports?page=choose");
    const list = await listPages(E, owner.accountId);
    expect(list.offers).toEqual([{ pageId: PAGE, pageName: "Own page" }]);
    expect(await connectPage(E, owner.accountId, { pageId: "200" })).toBe("not_found");
    noTokenAnywhere(JSON.stringify(list));
    // The app's secret and the code go in a form body, never in an address.
    expect(fake.forms.join()).toContain(SECRET);
    noTokenAnywhere(fake.asked.join());
    noTokenAnywhere(logged.join());
    const stored = await env.DB.prepare("SELECT token FROM import_page_offers WHERE account_id = ?")
      .bind(owner.accountId)
      .first<{ token: string }>();
    expect(stored?.token).toMatch(/^[\w-]+\.[\w-]+$/);
    noTokenAnywhere(stored?.token ?? "");
  });

  it("says so when the person runs no page of their own", async () => {
    const owner = await person("Enginn");
    const fake = fakePlatform();
    fake.pages = fake.pages.slice(1);
    expect(await signIn(owner)).toBe("/imports?page=none");
    expect((await listPages(E, owner.accountId)).offers).toEqual([]);
  });

  it("refuses a callback with a forged state, without a flow or from another session", async () => {
    const owner = await person("Rétt");
    const stranger = await person("Annar");
    fakePlatform();
    const session = await browser(owner);
    const started = await app("/auth/page/start", session);
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
    const flow = cookieOf(started, "__Host-page-flow");
    const callback = (query: string, cookie: string) =>
      app(`/auth/page/callback?code=the-code&${query}`, cookie);
    expect((await callback("state=forged", `${session}; ${flow}`)).status).toBe(400);
    expect((await callback(`state=${state}`, session)).status).toBe(400);
    const other = await browser(stranger);
    expect((await callback(`state=${state}`, `${other}; ${flow}`)).status).toBe(401);
    expect((await listPages(E, stranger.accountId)).offers).toEqual([]);
    expect((await listPages(E, owner.accountId)).offers).toEqual([]);
  });

  it("refuses to start without a session", async () => {
    fakePlatform();
    expect((await app("/auth/page/start")).status).toBe(401);
  });

  it("lets an offer lapse after its hour", async () => {
    const owner = await person("Seinn");
    fakePlatform();
    await signIn(owner);
    expect(await expirePageOffers(E, Date.now() + 2 * HOUR_MS)).toBeGreaterThan(0);
    expect((await listPages(E, owner.accountId)).offers).toEqual([]);
    expect(await connectPage(E, owner.accountId, { pageId: PAGE })).toBe("not_found");
  });

  it("spends the offer when it is chosen", async () => {
    const owner = await person("Valið");
    await connected(owner);
    expect((await listPages(E, owner.accountId)).offers).toEqual([]);
  });
});

describe("the first collection", () => {
  it("waits for the person, across several parts, without a visitor's post", async () => {
    const owner = await person("Bakgrunnur");
    const posts = Array.from({ length: 25 }, (_, i) => post(String(i + 1), `Færsla ${i + 1}`));
    const visitor = post("99", "Frá gesti", { from: { id: "someone-else" } });
    const anonymous = post("98", "Án höfundar", { from: undefined });
    const { importId } = await connected(owner, [visitor, anonymous, ...posts]);
    await tick();
    expect((await connectionOf(owner, importId)).state).toBe("preview");
    const items = await env.DB.prepare(
      "SELECT item_id AS id FROM import_file_items WHERE import_id = ?",
    )
      .bind(importId)
      .all<{ id: string }>();
    expect(items.results.map((i) => i.id).sort()).toEqual(
      posts.map((p) => String(p.id).split("_")[1]).sort(),
    );
    expect(await wall(owner)).toEqual([]);
    noTokenAnywhere(logged.join());
  });

  it("stores a page's photos and links a video, and ignores other hosts", async () => {
    const owner = await person("Myndir");
    const photo = (src: string) => ({ media_type: "photo", media: { image: { src } } });
    const { importId } = await connected(owner, [
      post("1", "Albúm", {
        attachments: {
          data: [
            {
              media_type: "album",
              subattachments: { data: [photo(`${MEDIA}/a.png`), photo("https://evil.example/b")] },
            },
          ],
        },
      }),
      post("2", "Myndband", { attachments: { data: [{ media_type: "video" }] } }),
    ]);
    await tick();
    const rows = await env.DB.prepare(
      `SELECT item_id AS id, images, has_video AS hasVideo, link FROM import_file_items
        WHERE import_id = ? ORDER BY item_id`,
    )
      .bind(importId)
      .all<{ id: string; images: string; hasVideo: number; link: string | null }>();
    expect(JSON.parse(rows.results[0]?.images ?? "")).toHaveLength(1);
    expect(rows.results[1]?.hasVideo).toBe(1);
    expect(rows.results[1]?.link).toContain("/posts/2");
  });

  it("goes straight to daily runs when the page holds nothing", async () => {
    const owner = await person("Tómt");
    const { importId } = await connected(owner, []);
    await tick();
    expect(await row(importId)).toMatchObject({ phase: "sync", outcome: "ok" });
    expect((await connectionOf(owner, importId)).state).toBe("connected");
  });
});

describe("the daily runs", () => {
  it("brings in a new post once, and not one the person left out", async () => {
    const owner = await person("Dagleg");
    const { fake, importId } = await syncing(
      owner,
      [post("1", "Valin"), post("2", "Sleppt")],
      ["2"],
    );
    expect(await wall(owner)).toEqual(["Valin"]);
    expect((await row(importId))?.phase).toBe("sync");
    // Dated ahead, so both runs below read it.
    const soon = new Date(Date.now() + 3 * SYNC_AFTER_MS).toISOString();
    fake.posts.unshift(post("3", "Ný", { created_time: soon }));
    await tick(SYNC_AFTER_MS + 1);
    expect((await wall(owner)).sort()).toEqual(["Ný", "Valin"]);
    await env.DB.prepare("UPDATE import_page_connections SET next_run_at = 1 WHERE import_id = ?")
      .bind(importId)
      .run();
    await tick();
    expect((await wall(owner)).sort()).toEqual(["Ný", "Valin"]);
    expect((await connectionOf(owner, importId)).outcome).toBe("ok");
    noTokenAnywhere(logged.join());
  });

  it("stops asking and waits for the person when the token is refused", async () => {
    const owner = await person("Útrunnið");
    const { fake, importId } = await connected(owner, [post("1", "Fyrsta")]);
    fake.accepted = "a-later-token";
    await tick();
    expect(await row(importId)).toMatchObject({ outcome: "expired", nextRunAt: null });
    await onlyThis(importId);
    fake.asked.length = 0;
    await tick(30 * SYNC_AFTER_MS);
    expect(fake.asked).toEqual([]);
    // Signing in again gives a token that works, and the same connection runs on.
    fake.accepted = PAGE_TOKEN;
    await signIn(owner);
    const again = await connectPage(E, owner.accountId, { pageId: PAGE });
    expect(again).toMatchObject({ importId, outcome: null });
    await tick();
    expect((await connectionOf(owner, importId)).state).toBe("preview");
  });

  it("tries again in an hour after a failure, and logs no token", async () => {
    const owner = await person("Bilun");
    const { fake, importId } = await connected(owner, [post("1", "Fyrsta")]);
    fake.broken = true;
    await tick();
    const failed = await row(importId);
    expect(failed?.outcome).toBe("failed");
    expect(failed?.nextRunAt).toBeGreaterThan(Date.now() + HOUR_MS / 2);
    fake.broken = false;
    await tick(HOUR_MS + 1);
    expect((await connectionOf(owner, importId)).state).toBe("preview");
    noTokenAnywhere(logged.join());
  });
});

describe("limits and removal", () => {
  it("counts page and profile connections against one cap", async () => {
    const owner = await person("Þak");
    const fake = await connected(owner);
    for (const [id, name] of [
      ["301", "Önnur"],
      ["302", "Þriðja"],
      ["303", "Fjórða"],
    ] as const) {
      fake.fake.pages.push({ id, name, access_token: `t${id}`, tasks: ["MANAGE"] });
    }
    await signIn(owner);
    expect(await connectPage(E, owner.accountId, { pageId: "301" })).toMatchObject({
      pageName: "Önnur",
    });
    expect(await connectPage(E, owner.accountId, { pageId: "302" })).toMatchObject({
      pageName: "Þriðja",
    });
    expect(await connectPage(E, owner.accountId, { pageId: "303" })).toBe("conflict");
    const both = {
      ...E,
      IMPORT_SCRAPE: "on",
      IMPORT_SCRAPE_TOKEN: "token",
      IMPORT_SCRAPE_MONTHLY_USD: "5",
      IMPORT_SCRAPE_CONFIG: JSON.stringify({
        api: "https://provider.example/v2",
        actor: "someone~posts",
        sourceHosts: ["source.example"],
        mediaHosts: ["media.source.example"],
        usdPerPost: 0.01,
        usdPerRun: 0.01,
      }),
    } as unknown as Env;
    expect(
      await createConnection(both, owner.accountId, {
        profileUrl: "https://www.source.example/somebody",
      }),
    ).toBe("conflict");
  });

  it("connects the same page once, keeping its posts", async () => {
    const owner = await person("Tvisvar");
    const { importId } = await connected(owner, [post("1", "Fyrsta")]);
    await signIn(owner);
    expect(await connectPage(E, owner.accountId, { pageId: PAGE })).toMatchObject({ importId });
    expect((await listPages(E, owner.accountId)).connections).toHaveLength(1);
  });

  it("leaves no token and no runs after a removal, and no posts in the end", async () => {
    const owner = await person("Fjarlægt");
    const { fake, importId } = await syncing(owner, [post("1", "Fer")]);
    expect(await wall(owner)).toEqual(["Fer"]);
    expect(await removePage(E, owner.accountId, importId)).toBe("ok");
    const after = await row(importId);
    expect(after === null || after.token === "").toBe(true);
    expect(after?.nextRunAt ?? null).toBeNull();
    await onlyThis(importId);
    fake.asked.length = 0;
    await tick(30 * SYNC_AFTER_MS);
    expect(fake.asked).toEqual([]);
    expect(await wall(owner)).toEqual([]);
    expect((await listPages(E, owner.accountId)).connections).toEqual([]);
  });

  it("will not remove another person's connection", async () => {
    const owner = await person("Eigandi");
    const stranger = await person("Ókunnugur");
    const { importId } = await connected(owner);
    expect(await removePage(E, stranger.accountId, importId)).toBe("not_found");
    expect(await connectionOf(owner, importId)).toBeDefined();
  });
});

describe("the routes", () => {
  it("answers as switched off where the feed is off", async () => {
    const owner = await person("Leið");
    const list = await ok<{ available: boolean }>(await owner.call("GET", "/v1/imports/pages"));
    expect(list.available).toBe(false);
    const made = await owner.call("POST", "/v1/imports/pages", { pageId: PAGE });
    expect(made.status).toBe(503);
    const gone = await owner.call("DELETE", `/v1/imports/pages/im_${"0".repeat(32)}`);
    expect(gone.status).toBe(404);
  });
});
