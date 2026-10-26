import type { HonoRequest } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../http.ts";
import { minClientVersions, updateUrls } from "../env/index.ts";
import { fail } from "./errors.ts";

// The client version floor (decision 0030): every request names its build in
// Spjall-Client, and a build below its platform's minimum is told to update.

/** `<platform>/<major.minor.patch>`, set by the core on every request. */
export const CLIENT_HEADER = "spjall-client";

const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** The version of every build made before the header existed. */
const UNNAMED = "0.1.0";

/** Orders two `major.minor.patch` versions. */
function compare(a: string, b: string): number {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export type FloorRefusal =
  | { error: "invalid_request" }
  | { error: "client_too_old"; minVersion: string; updateUrl?: string };

/** Where each mobile platform gets a current build (decision 0030). */
export type UpdateUrls = { android: string; ios: string };

/** Why a request with this Spjall-Client may not go on, or null. */
export function belowFloor(env: Env, header: string | undefined): FloorRefusal | null {
  return belowFloorOf(minClientVersions(env), header, updateUrls(env));
}

/**
 * The build a request names: its Spjall-Client header, or, on a WebSocket
 * upgrade, the `client` query parameter, since a browser cannot set a
 * header on its socket (decision 0081).
 */
function namedClient(request: HonoRequest): string | undefined {
  const header = request.header(CLIENT_HEADER);
  if (header !== undefined) return header;
  if (request.header("upgrade")?.toLowerCase() !== "websocket") return undefined;
  return request.query("client");
}

/** Every /v1 route refuses a build below its platform's floor (decision 0030). */
export const clientFloor = createMiddleware<AppEnv>(async (c, next) => {
  const refusal = belowFloor(c.env, namedClient(c.req));
  if (!refusal) return next();
  if (refusal.error === "invalid_request") return fail(c, 400, refusal.error);
  return fail(c, 426, refusal.error, {
    minVersion: refusal.minVersion,
    ...(refusal.updateUrl ? { updateUrl: refusal.updateUrl } : {}),
  });
});

/**
 * The same against any clients' floors: a header names one of them, and a
 * request without one is `UNNAMED` on whichever app floor is highest. Only
 * an app built before the header leaves it out; the web always sends it.
 * A refusal names the platform's update URL when there is one (decision 0030).
 */
export function belowFloorOf(
  floors: Readonly<Record<string, string>>,
  header: string | undefined,
  urls?: UpdateUrls,
): FloorRefusal | null {
  let version = UNNAMED;
  let platform: string | undefined;
  let floor = Object.entries(floors)
    .flatMap(([client, min]) => (client === "web" ? [] : [min]))
    .reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  if (header !== undefined) {
    const slash = header.indexOf("/");
    platform = header.slice(0, slash);
    version = header.slice(slash + 1);
    if (slash < 0 || !Object.hasOwn(floors, platform) || !VERSION.test(version))
      return { error: "invalid_request" };
    floor = floors[platform]!;
  }
  if (compare(version, floor) >= 0) return null;
  const updateUrl = platform === "android" || platform === "ios" ? urls?.[platform] : undefined;
  return {
    error: "client_too_old",
    minVersion: floor,
    ...(updateUrl ? { updateUrl } : {}),
  };
}
