import ids from "../../identifiers/ids.json" with { type: "json" };
import { API_PATHS } from "../src/paths.ts";
import worker from "../src/worker.ts";
import { withFakes } from "./oidc.ts";
import { devRoute } from "./routes.ts";

// Staging (decision 0118): the real Worker on its own storage, on a public
// workers.dev address, with a fake sign-in. Anyone reaching it could sign in as
// anyone and store files on Samtak's account, so nothing answers without the
// gate, whatever the path. Everything here lives under dev/, and
// `jurisdiction-check.mjs` holds production to src/index.ts with no import of it.
//
// It differs from src/index.ts in these ways only:
// - `gated` answers first: the STAGING_GATE secret, as a header from a tool or
//   as a cookie a browser got from GATE_PATH, or else 404. Unset, always 404;
// - the fake Kenni and Google (dev/oidc.ts), with the issuer made from the
//   origin the request came to, which this repository does not name;
// - the routes in dev/routes.ts;
// - the production host is written into the Worker and its contract (session
//   cookies, callback URLs), so at the edge of this Worker the request's own
//   Origin is translated to it and a redirect to it comes back to this origin;
// - cf-connecting-ip is dropped, as in dev/worker.ts: a tool seeds from one
//   address and the per-address limit would stop it;
// - static files reach the Worker first (cloudflare.config.ts), so it serves
//   them itself once the gate has passed.

export const GATE_HEADER = "x-staging-gate";
export const GATE_COOKIE = "__Host-staging-gate";
export const GATE_PATH = "/__staging-gate";
/** As `opsToken`: a shorter secret is treated as none. */
const GATE_MIN_LENGTH = 32;
const GATE_COOKIE_DAYS = 30;

const WEB_ORIGIN = `https://${ids.hosts.web}`;

/** The secret is staging's alone, so production's types never name it. */
type StagingEnv = Env & { STAGING_GATE?: string };

const notFound = () => new Response(null, { status: 404 });

/** Compared as digests, so neither the length nor a prefix can be timed. */
async function same(presented: string, secret: string): Promise<boolean> {
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [a, b] = await Promise.all([digest(presented), digest(secret)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** A malformed cookie is no gate, and has to read as every other wrong one does. */
function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The cookie header without the gate's, which nothing behind it should see. */
function withoutGate(cookie: string): { gate: string | null; rest: string } {
  const parts = cookie.split(";").map((part) => part.trim());
  const prefix = `${GATE_COOKIE}=`;
  const found = parts.find((part) => part.startsWith(prefix));
  return {
    gate: found ? decoded(found.slice(prefix.length)) : null,
    rest: parts.filter((part) => part && !part.startsWith(prefix)).join("; "),
  };
}

/** GATE_PATH?key=<secret>: the cookie that lets this browser in, then the app. */
async function openFor(url: URL, request: Request, secret: string): Promise<Response> {
  const key = url.searchParams.get("key");
  if (request.method !== "GET" || key === null || !(await same(key, secret))) return notFound();
  const maxAge = GATE_COOKIE_DAYS * 24 * 60 * 60;
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `${GATE_COOKIE}=${encodeURIComponent(secret)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      // The key is in this URL: it stays out of caches and of the next page's Referer.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

/**
 * Lets a request through to `inner` only with the gate, without it, and answers
 * every other one 404 with an empty body, the same whatever was wrong.
 */
export async function gated(
  request: Request,
  secret: string | undefined,
  inner: (request: Request) => Promise<Response> | Response,
): Promise<Response> {
  if (!secret || secret.length < GATE_MIN_LENGTH) return notFound();
  const url = new URL(request.url);
  if (url.pathname === GATE_PATH) return openFor(url, request, secret);
  const { gate, rest } = withoutGate(request.headers.get("cookie") ?? "");
  const presented = request.headers.get(GATE_HEADER) ?? gate;
  if (presented === null || !(await same(presented, secret))) return notFound();
  const headers = new Headers(request.headers);
  headers.delete(GATE_HEADER);
  if (rest) headers.set("cookie", rest);
  else headers.delete("cookie");
  return inner(new Request(request, { headers }));
}

/** A redirect to the production host, sent to this origin. Any other response is untouched. */
function rehomed(response: Response, origin: string): Response {
  const location = response.headers.get("location");
  if (location === null || !location.startsWith(`${WEB_ORIGIN}/`)) return response;
  const moved = new Response(response.body, response);
  moved.headers.set("location", `${origin}${location.slice(WEB_ORIGIN.length)}`);
  return moved;
}

async function behindGate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  web: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const staged = {
    ...env,
    KENNI_ISSUER: `${url.origin}/dev/kenni`,
    GOOGLE_ISSUER: `${url.origin}/dev/google`,
  } as Env;
  const fakes = withFakes(request, staged);
  if (fakes.response) return fakes.response;
  const route = await devRoute(request, staged);
  if (route) return route;
  if (!API_PATHS.test(url.pathname)) {
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return web(request);
  }
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  if (headers.get("origin") === url.origin) headers.set("origin", WEB_ORIGIN);
  return worker.fetch(new Request(request, { headers }), { ...staged, ...fakes.env }, ctx);
}

/** The Worker's `fetch`, with the web app passed in so a test need not bundle it. */
export function stagingFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  web: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  return gated(request, (env as StagingEnv).STAGING_GATE, async (inner) =>
    rehomed(await behindGate(inner, env, ctx, web), new URL(inner.url).origin),
  );
}
