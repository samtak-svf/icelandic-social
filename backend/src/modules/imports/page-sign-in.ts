import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import ids from "../../../../identifiers/ids.json" with { type: "json" };
import { db, withinLimit } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { randomToken, sessionCookie, signedIn, suspension } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { seal, unseal } from "../../shared/seal.ts";
import {
  authorizeAddress,
  FLOW_LABEL,
  type ManagedPage,
  type PageSettings,
  pageSettings,
  pagesForCode,
  TOKEN_LABEL,
} from "./page.ts";

// Signing in at the platform to offer a person's pages (decision 0120), outside the API
// and its contract because a browser walks it, as web sign-in does. The Worker redeems
// the code, so the browser never sees a token. What comes back is an offer of the pages
// the person manages, kept for an hour; nothing is read until one is chosen.

const FLOW_COOKIE = "page-flow";
const FLOW_MS = 10 * 60 * 1000;
const OFFER_MS = 60 * 60 * 1000;
const CALLBACK = "/auth/page/callback";
const DONE = "/imports";

type Flow = { state: string; sessionId: string; expires: number };

const redirectUri = () => `https://${ids.hosts.web}${CALLBACK}`;

async function refusedAddress(c: Context<AppEnv>) {
  const address = c.req.header("cf-connecting-ip");
  if (!address || (await withinLimit(c.env, "public", address))) return null;
  log("request.rate_limited", { code: "public", requestId: c.var.requestId });
  return fail(c, 429, "rate_limited");
}

async function start(c: Context<AppEnv>) {
  const refused = await refusedAddress(c);
  if (refused) return refused;
  const session = await signedIn(c);
  if (!session) return fail(c, 401, "unauthorized");
  const settings = pageSettings(c.env);
  if (!settings) return fail(c, 503, "unavailable");
  const stands = await suspension(c.env, session.accountId);
  if (stands) {
    return fail(c, 403, "suspended", stands.until === null ? {} : { until: stands.until });
  }
  const flow: Flow = {
    state: randomToken(""),
    sessionId: session.sessionId,
    expires: Date.now() + FLOW_MS,
  };
  setCookie(
    c,
    FLOW_COOKIE,
    await seal(settings.key, FLOW_LABEL, flow),
    sessionCookie(flow.expires),
  );
  c.header("cache-control", "no-store");
  return c.redirect(authorizeAddress(settings, redirectUri(), flow.state), 302);
}

/** Replaces the person's offers with these pages, tokens sealed. */
async function storeOffers(
  env: Env,
  settings: PageSettings,
  accountId: string,
  pages: ManagedPage[],
) {
  const expires = Date.now() + OFFER_MS;
  const rows = await Promise.all(
    pages.map(async (page) =>
      db(env)
        .prepare(
          `INSERT INTO import_page_offers (account_id, page_id, page_name, token, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          accountId,
          page.id,
          page.name,
          await seal(settings.key, TOKEN_LABEL, page.token),
          expires,
        ),
    ),
  );
  await db(env).batch([
    db(env).prepare("DELETE FROM import_page_offers WHERE account_id = ?").bind(accountId),
    ...rows,
  ]);
}

/** Back from the platform: the cookie is spent whatever follows, and only its session gets offers. */
async function callback(c: Context<AppEnv>) {
  const refused = await refusedAddress(c);
  if (refused) return refused;
  const cookie = getCookie(c, FLOW_COOKIE, "host");
  deleteCookie(c, FLOW_COOKIE, sessionCookie(0));
  const settings = pageSettings(c.env);
  if (!settings) return fail(c, 503, "unavailable");
  const flow = cookie ? await unseal<Flow>(settings.key, FLOW_LABEL, cookie) : null;
  if (!flow || flow.expires <= Date.now() || flow.state !== c.req.query("state")) {
    log("imports.page_sign_in_failed", { code: "flow_mismatch", requestId: c.var.requestId });
    return fail(c, 400, "invalid_request");
  }
  const session = await signedIn(c);
  if (session?.sessionId !== flow.sessionId) {
    log("imports.page_sign_in_failed", { code: "session_mismatch", requestId: c.var.requestId });
    return fail(c, 401, "unauthorized");
  }
  c.header("cache-control", "no-store");
  const given = c.req.query("code");
  // The person said no at the platform: nothing failed, and nothing is offered.
  if (!given) return c.redirect(`${DONE}?page=declined`, 303);
  try {
    const pages = await pagesForCode(settings, redirectUri(), given);
    await storeOffers(c.env, settings, session.accountId, pages);
    log("imports.page_offered", { accountId: session.accountId, count: pages.length });
    return c.redirect(`${DONE}?page=${pages.length > 0 ? "choose" : "none"}`, 303);
  } catch (error) {
    // The kind of error only: its text could carry what the platform answered.
    const code = error instanceof Error ? error.constructor.name : "unknown";
    log("imports.page_sign_in_failed", { code, requestId: c.var.requestId });
    return c.redirect(`${DONE}?page=failed`, 303);
  }
}

/** The routes a browser walks to sign in at the platform. */
export function pageSignInRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/auth/page/start", start);
  routes.get(CALLBACK, callback);
  return routes;
}
