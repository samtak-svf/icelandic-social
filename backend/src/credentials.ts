import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import ids from "../../identifiers/ids.json" with { type: "json" };
import type { AppEnv } from "./http.ts";
import { withinLimit } from "./env/index.ts";
import { fail } from "./errors.ts";
import {
  deviceForToken,
  type Device,
  linkedDeviceOfSession,
  SESSION_COOKIE,
  SESSION_SECRET,
  sessionCookie,
  sessionForSecret,
  wipeBrowserStorage,
} from "./identity/index.ts";
import { log, timed } from "./log.ts";

// The credentials a request presents (decision 0061). Every route declares
// the security schemes it takes in the contract, and these guards read that
// declaration, so a route takes exactly what api/openapi.json says it does.

/** A credential a route can declare: the names of its security schemes. */
type Scheme = "deviceToken" | "session";

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

/** The web app's origin: the only one a request with the session cookie may come from. */
const WEB_ORIGIN = `https://${ids.hosts.web}`;

const CHANGES_STATE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Names the two schemes in the contract. */
export function registerSchemes(app: OpenAPIHono<AppEnv>) {
  app.openAPIRegistry.registerComponent("securitySchemes", "deviceToken", {
    type: "http",
    scheme: "bearer",
    description: "The device token from registerDevice (decision 0014)",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: `__Host-${SESSION_COOKIE}`,
    description: "A browser's session, signed in on the web host (decision 0061)",
  });
}

/**
 * What a request to this method and path may present: the schemes its route
 * declares, `[]` for a public route, or null for a route that declares none,
 * which then takes nothing. A path that is no route takes a device token, so
 * it answers 401 before 404 as it always has.
 */
function declaredSchemes(app: OpenAPIHono<AppEnv>) {
  let routes: { method: string; path: RegExp; schemes: Scheme[] | null }[] | undefined;
  return (method: string, path: string): Scheme[] | null => {
    routes ??= app.openAPIRegistry.definitions.flatMap((d) =>
      d.type === "route"
        ? [
            {
              method: d.route.method.toUpperCase(),
              path: new RegExp(`^${d.route.path.replace(/\{[^/}]+\}/g, "[^/]+")}$`),
              schemes: (d.route.security?.flatMap(Object.keys) as Scheme[] | undefined) ?? null,
            },
          ]
        : [],
    );
    const route = routes.find((r) => r.method === method && r.path.test(path));
    return route ? route.schemes : ["deviceToken"];
  };
}

/** A device token must name an active device in D1 (decision 0014), which yields its session. */
async function byToken(c: Context<AppEnv>, token: string) {
  const found = await timed("auth.token_checked", c.var, () => deviceForToken(c.env, token));
  if (!found) return false;
  c.set("device", found.device);
  c.set("session", found.session);
  return true;
}

/** A session secret must name a live browser session, renewed as it is used. */
async function bySession(c: Context<AppEnv>, secret: string) {
  const found = await timed("auth.session_checked", c.var, () => sessionForSecret(c.env, secret));
  if (!found) return false;
  c.set("session", found.session);
  if (found.renewed) setCookie(c, SESSION_COOKIE, secret, sessionCookie(found.renewed));
  return true;
}

/**
 * The guards that read each route's declaration. The public routes are
 * limited per address. Cloudflare sets cf-connecting-ip on every request it
 * serves; only workerd on its own, in tests and `cf dev`, leaves it out, and
 * those are not limited.
 */
export function guards(app: OpenAPIHono<AppEnv>) {
  const schemesOf = declaredSchemes(app);

  const publicLimit = createMiddleware<AppEnv>(async (c, next) => {
    const address = c.req.header("cf-connecting-ip");
    if (schemesOf(c.req.method, c.req.path)?.length !== 0 || !address) return next();
    if (await withinLimit(c.env, "public", address)) return next();
    log("request.rate_limited", { code: "public", requestId: c.var.requestId });
    return fail(c, 429, "rate_limited");
  });

  /**
   * A request that changes state with the session cookie must come from the
   * web host, and a missing Origin is refused too: SameSite=Lax is the second
   * line, not the only one. Then the route's declaration decides which
   * credential counts. Each check's time is logged: every authenticated
   * request pays it first (decision 0056).
   */
  const credentials = createMiddleware<AppEnv>(async (c, next) => {
    const secret = getCookie(c, SESSION_COOKIE, "host");
    const changes = CHANGES_STATE.has(c.req.method);
    if (secret !== undefined && changes && c.req.header("origin") !== WEB_ORIGIN) {
      return fail(c, 403, "forbidden_origin");
    }
    const schemes = schemesOf(c.req.method, c.req.path);
    if (schemes?.length === 0) return next();
    const takes = (scheme: Scheme) => schemes?.includes(scheme) ?? false;
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    if (token && takes("deviceToken")) {
      return (await byToken(c, token)) ? next() : fail(c, 401, "unauthorized");
    }
    if (secret && SESSION_SECRET.test(secret) && takes("session")) {
      if (await bySession(c, secret)) return next();
      deleteCookie(c, SESSION_COOKIE, sessionCookie(0));
      wipeBrowserStorage(c);
      return fail(c, 401, "unauthorized");
    }
    return fail(c, 401, "unauthorized");
  });

  return { publicLimit, credentials };
}

/**
 * The device a socket opens for when no device token named one: a browser's
 * session cookie is the one credential a page can send on a WebSocket, so it
 * must come from the web host (the guard checks Origin only on a request that
 * changes state) and opens the socket of its session's linked device
 * (decision 0081).
 */
export async function webSocketDevice(
  c: Context<AppEnv>,
): Promise<Device | "forbidden_origin" | "no_linked_device"> {
  if (c.req.header("origin") !== WEB_ORIGIN) return "forbidden_origin";
  return (await linkedDeviceOfSession(c.env, c.var.session)) ?? "no_linked_device";
}
