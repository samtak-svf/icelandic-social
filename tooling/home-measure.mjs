// @ts-check
// Whether the home feed holds at its heaviest viewer (decision 0116): a viewer
// with 500 friends and 50 communities, whose page of 30 posts sits in 30 spaces,
// so 30 calls to a space on every read. Seeds that viewer through the API and
// staging's fake sign-in, then times `GET /v1/home`, cold and warm apart.
//
//   STAGING_ORIGIN=<origin> STAGING_GATE=<gate> \
//     node tooling/home-measure.mjs --run <label> [--friends 500] [--communities 50]
//       [--posts 350] [--page 30] [--cold 10] [--idle 120] [--warm 30] [--skip-seed]
//       [--json <file>]
//
// `--run` names the seeded people, so a second run with the same label goes on
// from the first and a new label starts another viewer. `--skip-seed` measures
// what a run with that label left: its posts age out of the first window in a day.
// `--posts` is how many older posts the communities get, seven a day each by the
// workload doc (`docs/d1-social-workload.md`), so the window reads what it would.
// A friend's wall exists once they have posted, so the first run also writes one
// post per friend, 880 in the first window against the doc's 380: heavier, on the
// safe side. The same label 24 hours later seeds no friends and reads exactly 380.
// `--page` asks for that `limit`, to re-measure a shorter page with no deploy.
//
// The origin and the gate come from the environment and are never printed. It
// refuses a production host, anything but https outside loopback, and any origin
// whose sign-in is not the fake issuer, before it writes anything. Loopback takes
// no gate: `backend/scripts/dev-worker.sh start`, with `SPJALL_DEV_URL` as origin.
//
// What each figure means:
// - cold: one request after `--idle` seconds of none, each. Isolates and space
//   objects may or may not have gone in that time, so this is the worst usual
//   read, not a proven cold start. With ten samples the p95 is the slowest.
// - warm: requests one after another straight after, the first thrown away.
// - Both are measured from this machine, to the end of the body, network included.
// "Holds" means warm p95 under 1,000 ms (decision 0116).
// Exit: 0 measured, whatever the verdict; 1 the viewer is not the viewer asked
// for, or a read failed, since a number from another page measures nothing;
// 2 could not run.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const ROOT = new URL("../", import.meta.url);
const GATE_HEADER = "x-staging-gate";
const HOLDS_UNDER_MS = 1000;
const CONCURRENCY = 8;
const RETRIES = 8;
const BUSY_WAIT_MS = 30_000;
const SESSION_COOKIE = "__Host-session=";
/** Where staging's and local development's fake issuer signs in; never production's. */
const FAKE_ISSUER_PATH = /^\/dev\/(google|kenni)\//;

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));

/**
 * @param {string} hostname
 * @returns {boolean}
 */
const isLoopback = (hostname) =>
  hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(hostname);

/**
 * Why `origin` may not be measured, or null. Says nothing of the address itself.
 *
 * @param {string | undefined} origin
 * @param {string | undefined} gate
 * @param {string[]} productionHosts
 * @returns {string | null}
 */
export function refusal(origin, gate, productionHosts) {
  if (!origin) return "STAGING_ORIGIN is not set";
  /** @type {URL} */
  let url;
  try {
    url = new URL(origin);
  } catch {
    return "STAGING_ORIGIN is not a URL";
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (productionHosts.some((known) => host === known.toLowerCase())) {
    return "STAGING_ORIGIN is a production host";
  }
  if (isLoopback(host)) return null;
  if (url.protocol !== "https:") return "STAGING_ORIGIN must be https outside loopback";
  if (!gate) return "STAGING_GATE is not set";
  return null;
}

/**
 * The value at `share` of the sorted samples, by nearest rank: a real sample,
 * never one between two.
 *
 * @param {number[]} samples
 * @param {number} share
 * @returns {number}
 */
export function percentile(samples, share) {
  if (samples.length === 0) throw new Error("a percentile of nothing");
  const sorted = samples.toSorted((a, b) => a - b);
  return /** @type {number} */ (sorted[Math.max(Math.ceil(sorted.length * share) - 1, 0)]);
}

/**
 * @param {number[]} samples
 * @returns {{ samples: number, p50: number, p95: number, max: number }}
 */
export function spread(samples) {
  return {
    samples: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: percentile(samples, 1),
  };
}

/**
 * Whether a page is what the measure is of: `page` posts from `page` spaces. A
 * page in fewer spaces costs fewer calls and would flatter the figure.
 *
 * @param {{ communityId: string }[]} posts
 * @param {number} page
 * @returns {string | null} what is wrong with it, or null
 */
export function pageFault(posts, page) {
  if (posts.length !== page) return `the page has ${posts.length} posts, not ${page}`;
  const spaces = new Set(posts.map((post) => post.communityId)).size;
  return spaces === page ? null : `the page's ${page} posts sit in ${spaces} spaces`;
}

/**
 * A made-up kennitala from `start`: valid to the check digit, with a two-digit year
 * and a serial no person's has, computed and not written so that no file holds one.
 *
 * @param {number} start
 * @returns {string}
 */
export function madeUpKennitala(start) {
  const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
  for (let n = start; ; n++) {
    const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
    const first = `${pad((n % 28) + 1)}${pad((n % 12) + 1)}99${pad((n % 80) + 20)}`;
    const sum = WEIGHTS.reduce((total, weight, at) => total + weight * Number(first[at]), 0);
    const left = sum % 11;
    if (left === 1) continue;
    return `${first}${left === 0 ? 0 : 11 - left}0`;
  }
}

/** @param {string} label */
const seedOf = (label) => {
  let hash = 0;
  for (const char of label) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash;
};

/**
 * Which friend writes which post of the page: half on their own walls, the rest
 * one each in a community they joined, so `page` authors in `page` spaces.
 *
 * @param {number} page
 * @param {number} friends
 * @param {number} communities
 * @returns {{ walls: number, inCommunities: number } | null} null when they cannot fill it
 */
export function pagePlan(page, friends, communities) {
  const inCommunities = Math.min(Math.floor(page / 2), communities);
  const walls = page - inCommunities;
  return walls + inCommunities > friends ? null : { walls, inCommunities };
}

/**
 * @typedef {{ origin: string, gate: string | undefined, client: string, stateOrigin: string }} Target
 */

/** The viewer or the origin is not what the measure is of: exit 1, no figure. */
class Precondition extends Error {}

/**
 * A request, waiting out a rate limit. Never lets the address into an error.
 *
 * @param {Target} target
 * @param {string} path
 * @param {RequestInit & { cookie?: string }} [init]
 * @returns {Promise<Response>}
 */
async function call(target, path, init = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("spjall-client", target.client);
  if (target.gate) headers.set(GATE_HEADER, target.gate);
  if (cookie) headers.set("cookie", cookie);
  if (rest.method && rest.method !== "GET") headers.set("origin", target.stateOrigin);
  if (rest.body) headers.set("content-type", "application/json");
  for (let attempt = 0; ; attempt++) {
    /** @type {Response} */
    let response;
    try {
      response = await fetch(`${target.origin}${path}`, { redirect: "manual", ...rest, headers });
    } catch {
      throw new Error(`${rest.method ?? "GET"} ${path.split("?")[0]} could not reach the origin`);
    }
    if (response.status !== 429 || attempt >= RETRIES) return response;
    await response.body?.cancel();
    const after = Number(response.headers.get("retry-after")) * 1000;
    await new Promise((resolve) => setTimeout(resolve, after || BUSY_WAIT_MS));
  }
}

/**
 * The status must be a success or one of `allowed`, or the seed stops.
 *
 * @param {Target} target
 * @param {string} path
 * @param {RequestInit & { cookie?: string }} init
 * @param {number[]} [allowed]
 */
async function must(target, path, init, allowed = []) {
  const response = await call(target, path, init);
  if (!response.ok && !allowed.includes(response.status)) {
    const code = (await response.text()).slice(0, 120);
    throw new Error(`${init.method ?? "GET"} ${path} answered ${response.status}: ${code}`);
  }
  return response;
}

/**
 * The redirects of the fake issuer, to a response carrying what the flow sets.
 *
 * @param {Target} target
 * @param {string} start
 * @param {Record<string, string>} hint
 * @param {string} [cookie]
 * @returns {Promise<Response>}
 */
async function throughIssuer(target, start, hint, cookie) {
  const started = await must(target, start, { ...(cookie ? { cookie } : {}) }, [302]);
  const flow = started.headers.getSetCookie()[0]?.split(";")[0];
  const at = new URL(started.headers.get("location") ?? "", target.origin);
  if (!FAKE_ISSUER_PATH.test(at.pathname)) {
    throw new Precondition("this origin's sign-in is not the fake issuer");
  }
  for (const [key, value] of Object.entries(hint)) at.searchParams.set(key, value);
  const back = await must(target, `${at.pathname}${at.search}`, {}, [302]);
  const callback = new URL(back.headers.get("location") ?? "", target.origin);
  const both = [cookie, flow].filter(Boolean).join("; ");
  return must(target, `${callback.pathname}${callback.search}`, { cookie: both }, [302, 303]);
}

/**
 * Signs `subject` in, and returns its session cookie.
 *
 * @param {Target} target
 * @param {string} subject
 * @returns {Promise<string>}
 */
async function signIn(target, subject) {
  const signed = await throughIssuer(target, "/auth/google/start?next=/", {
    login_hint: subject,
    x_name: subject,
  });
  const line = signed.headers.getSetCookie().find((one) => one.startsWith(SESSION_COOKIE));
  if (!line) throw new Error("the sign-in set no session");
  return /** @type {string} */ (line.split(";")[0]);
}

/**
 * Runs `work` over `items`, a few at a time.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, at: number) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
async function pool(items, work) {
  /** @type {R[]} */
  const results = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await work(/** @type {T} */ (items[at]), at);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return results;
}

/**
 * @param {Response} response
 * @returns {Promise<any>} the API's own shape; the script reads only named fields
 */
const bodyOf = (response) => response.json();

/** @param {number} count */
const indexes = (count) => Array.from({ length: count }, (_, n) => n);

/** @param {Record<string, unknown>} body */
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

/**
 * A verified owner's community called `name`, made now or by an earlier run.
 *
 * @param {Target} target
 * @param {string} owner
 * @param {string} name
 * @returns {Promise<string>}
 */
async function communityNamed(target, owner, name) {
  const made = await must(
    target,
    "/v1/communities",
    { ...post({ name, audience: "open" }), cookie: owner },
    [409],
  );
  if (made.status === 200) return (await bodyOf(made)).communityId;
  await made.body?.cancel();
  const query = `/v1/communities?q=${encodeURIComponent(name)}`;
  const found = await bodyOf(await must(target, query, { cookie: owner }));
  const hit = found.communities.find((/** @type {{ name: string }} */ one) => one.name === name);
  if (!hit) throw new Error("a community that refused its name cannot be found by it");
  return hit.communityId;
}

/**
 * Seeds the viewer of this run and returns its session.
 *
 * @param {Target} target
 * @param {{ run: string, friends: number, communities: number, posts: number, page: number }} shape
 * @param {(line: string) => void} say
 * @returns {Promise<string>}
 */
async function seed(target, shape, say) {
  const { run, friends, communities, posts, page } = shape;
  const plan = pagePlan(page, friends, communities);
  if (!plan) throw new Precondition(`${friends} friends cannot write a page of ${page}`);
  const viewer = await signIn(target, `home-${run}-viewer`);
  const me = await bodyOf(await must(target, "/v1/me", { cookie: viewer }));
  const viewerId = me.accountId;

  const subject = (/** @type {number} */ n) => `home-${run}-f${n}`;
  const { count } = await bodyOf(await must(target, "/v1/friends", { cookie: viewer }));
  /** A friend's account and session; only the page's writers keep theirs. */
  const befriend = async (/** @type {number} */ n) => {
    const session = await signIn(target, subject(n));
    const friend = await bodyOf(await must(target, "/v1/me", { cookie: session }));
    const asked = `/v1/friend-requests/${viewerId}`;
    await must(target, asked, { method: "PUT", cookie: session }, [409]);
    const accept = `/v1/friend-requests/${friend.accountId}/accept`;
    await must(target, accept, { method: "POST", cookie: viewer }, [404]);
    // Every friend has a wall, as the measured viewer does: this is what the
    // statement joins, and a friend who never posted would make it cheaper.
    await must(target, "/v1/wall/posts", {
      ...post({ body: "seed", audience: "friends" }),
      cookie: session,
    });
    if ((n + 1) % 50 === 0) say(`  friends: ${n + 1}`);
    return session;
  };
  const writerCount = plan.walls + plan.inCommunities;
  say(count >= friends ? "friends: there already" : `friends: from ${count} to ${friends}`);
  const sessions =
    count >= friends
      ? await pool(indexes(writerCount), (n) => signIn(target, subject(n)))
      : (await pool(indexes(friends), befriend)).slice(0, writerCount);
  const after = await bodyOf(await must(target, "/v1/friends", { cookie: viewer }));
  if (after.count < friends) {
    throw new Precondition(`the viewer has ${after.count} friends, not ${friends}`);
  }

  say(`communities: ${communities}`);
  const owner = await signIn(target, `home-${run}-owner`);
  await throughIssuer(
    target,
    "/auth/kenni/start?next=/verify",
    { login_hint: madeUpKennitala(seedOf(run)), x_name: `home-${run}-owner` },
    owner,
  );
  const ids = await pool(indexes(communities), async (n) => {
    const id = await communityNamed(target, owner, `Home measure ${run} ${n}`);
    const join = `/v1/communities/${id}/join`;
    await must(target, join, { method: "POST", cookie: viewer }, [409]);
    return id;
  });

  say(`older posts: ${posts}`);
  await pool(indexes(posts), (n) =>
    must(target, `/v1/communities/${ids[n % communities]}/posts`, {
      ...post({ body: `older ${n}` }),
      cookie: owner,
    }),
  );

  say(`the page: ${plan.walls} walls and ${plan.inCommunities} communities`);
  await pool(indexes(plan.inCommunities), async (n) => {
    const session = /** @type {string} */ (sessions[plan.walls + n]);
    const id = ids[n];
    await must(target, `/v1/communities/${id}/join`, { method: "POST", cookie: session }, [409]);
    await must(target, `/v1/communities/${id}/posts`, {
      ...post({ body: `page ${n}` }),
      cookie: session,
    });
  });
  await pool(indexes(plan.walls), (n) =>
    must(target, "/v1/wall/posts", {
      ...post({ body: `page wall ${n}`, audience: "friends" }),
      cookie: /** @type {string} */ (sessions[n]),
    }),
  );
  return viewer;
}

/**
 * One timed read of the page, which must be the page.
 *
 * @param {Target} target
 * @param {string} viewer
 * @param {number} page
 * @returns {Promise<number>}
 */
async function timed(target, viewer, page) {
  const started = performance.now();
  const response = await call(target, `/v1/home?limit=${page}`, { cookie: viewer });
  const text = await response.text();
  const took = performance.now() - started;
  if (response.status !== 200) throw new Precondition(`a read answered ${response.status}`);
  const fault = pageFault(JSON.parse(text).posts, page);
  if (fault) throw new Precondition(fault);
  return took;
}

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: "string" },
      friends: { type: "string", default: "500" },
      communities: { type: "string", default: "50" },
      posts: { type: "string", default: "350" },
      page: { type: "string", default: "30" },
      cold: { type: "string", default: "10" },
      idle: { type: "string", default: "120" },
      warm: { type: "string", default: "30" },
      "skip-seed": { type: "boolean", default: false },
      json: { type: "string" },
    },
  });
  const run = values.run;
  if (!run || !/^[a-z0-9]{1,32}$/.test(run)) throw new Error("--run <label>, a-z and 0-9");
  const [friends, communities, posts, page, cold, idle, warm] = [
    values.friends,
    values.communities,
    values.posts,
    values.page,
    values.cold,
    values.idle,
    values.warm,
  ].map(Number);
  const numbers = [friends, communities, posts, page, cold, idle, warm];
  if (numbers.some((n) => !Number.isInteger(n) || Number(n) < 0)) {
    throw new Error("the counts are whole numbers");
  }

  const hosts = readJson("identifiers/ids.json").hosts;
  const productionHosts = [hosts.api, hosts.link, hosts.web];
  const origin = process.env.STAGING_ORIGIN;
  const gate = process.env.STAGING_GATE;
  const refused = refusal(origin, gate, productionHosts);
  if (refused) throw new Error(refused);
  const url = new URL(/** @type {string} */ (origin));
  /** @type {Target} */
  const target = {
    origin: url.origin,
    gate,
    client: `web/${readJson("web/package.json").version}`,
    // Staging translates its own origin; loopback holds the production web origin.
    stateOrigin: isLoopback(url.hostname) ? `https://${hosts.web}` : url.origin,
  };
  const say = (/** @type {string} */ line) => console.error(line);

  const shape = {
    run,
    friends: Number(friends),
    communities: Number(communities),
    posts: Number(posts),
    page: Number(page),
  };
  const viewer = values["skip-seed"]
    ? await signIn(target, `home-${run}-viewer`)
    : await seed(target, shape, say);

  // The figure is of this page, so a page that is not it stops the run here.
  await timed(target, viewer, shape.page);

  /** @type {number[]} */
  const coldSamples = [];
  for (let n = 0; n < Number(cold); n++) {
    say(`cold ${n + 1} of ${cold}, after ${idle} s`);
    await new Promise((resolve) => setTimeout(resolve, Number(idle) * 1000));
    coldSamples.push(await timed(target, viewer, shape.page));
  }
  await timed(target, viewer, shape.page);
  /** @type {number[]} */
  const warmSamples = [];
  for (let n = 0; n < Number(warm); n++) warmSamples.push(await timed(target, viewer, shape.page));
  if (warmSamples.length === 0) throw new Precondition("no warm samples, so no verdict");

  const warmFigures = spread(warmSamples);
  const report = {
    page: shape.page,
    cold: coldSamples.length > 0 ? spread(coldSamples) : null,
    warm: warmFigures,
    holdsUnderMs: HOLDS_UNDER_MS,
    holds: warmFigures.p95 < HOLDS_UNDER_MS,
  };
  if (values.json) writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
  const row = (/** @type {string} */ name, /** @type {ReturnType<typeof spread> | null} */ s) =>
    s
      ? `${name}: p50 ${Math.round(s.p50)} ms, p95 ${Math.round(s.p95)} ms, max ${Math.round(s.max)} ms, ${s.samples} samples`
      : `${name}: not measured`;
  console.log(`GET /v1/home, a page of ${shape.page} in ${shape.page} spaces`);
  console.log(row("cold", report.cold));
  console.log(row("warm", report.warm));
  console.log(
    report.holds
      ? `holds: warm p95 is under ${HOLDS_UNDER_MS} ms`
      : `does not hold: warm p95 is not under ${HOLDS_UNDER_MS} ms; the page goes to 20, then 15`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof Precondition ? 1 : 2);
  });
}
