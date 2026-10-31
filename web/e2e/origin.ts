import { test as base, type Page } from "@playwright/test";
import ids from "../../identifiers/ids.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

/** What a spec's own API call says it is: the floor refuses anything older (decision 0030). */
export const CLIENT = { "spjall-client": `web/${pkg.version}` };

/** Where `cf dev` listens: backend/scripts/dev-worker.sh exports its URL; 8787 when run by hand. */
export const DEV = process.env.SPJALL_DEV_URL ?? "http://127.0.0.1:8787";

/** The web's real origin, which the session cookie and its Origin check name. */
export const WEB = `https://${ids.hosts.web}`;

/** A module of the web's dev build: the same bytes for every browser, whoever is signed in. */
const MODULE = /^\/(@fs|@id|@vite|@react-refresh|@tanstack-start|node_modules)\//;

type Fulfilled = { status: number; headers: Record<string, string>; body: Buffer };

/**
 * The modules this worker has already fetched. Each person in a test is a new
 * browser context with an empty HTTP cache, so without this every sign-in
 * fetches every module through this proxy again, and that, not the API, is
 * where a test's time goes (a poll test with three people: 27,000 module
 * requests beside 1,800 to the API).
 */
const modules = new Map<string, Fulfilled>();

/**
 * Every request to the web's origin goes to `cf dev` instead, and its answer
 * comes back as the origin's. The browser then holds a `__Host-` cookie in a
 * secure context and sends the Origin the Worker accepts (decision 0061),
 * exactly as in production, with no flag that loosens either.
 *
 * Chromium follows a redirect without routing it again, fulfilled or not, so
 * a redirect comes back as a page that navigates to its target: that
 * navigation is a new request, and routed. `cf dev`'s own pages (the fake
 * providers) go through the same handler for their redirect to the callback.
 * Any other host is refused, so a test never reaches the real one.
 */
export async function serveOrigin(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const target =
      url.origin === WEB ? DEV : url.origin === new URL(DEV).origin ? url.origin : null;
    if (!target) return route.abort("blockedbyclient");
    const moduleKey =
      request.method() === "GET" && MODULE.test(url.pathname) ? url.pathname + url.search : null;
    const held = moduleKey === null ? undefined : modules.get(moduleKey);
    if (held) return route.fulfill(held);
    // Node's fetch rather than route.fetch, which would send the cookies
    // the browser holds for `cf dev`'s host instead of the web's.
    const headers = Object.entries(await request.allHeaders()).filter(
      ([name]) => name !== "host" && name !== "accept-encoding" && !name.startsWith(":"),
    );
    const postData = request.postDataBuffer();
    const answer = await fetch(`${target}${url.pathname}${url.search}`, {
      method: request.method(),
      headers,
      body: postData === null ? undefined : new Uint8Array(postData),
      redirect: "manual",
    });
    const fulfilled: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (name !== "set-cookie" && name !== "content-encoding") fulfilled[name] = value;
    });
    // Playwright takes several cookies as one header, a line each.
    const cookies = answer.headers.getSetCookie();
    if (cookies.length > 0) fulfilled["set-cookie"] = cookies.join("\n");
    const location = answer.headers.get("location");
    if (location && answer.status >= 300 && answer.status < 400) {
      const next = new URL(location, url).toString();
      fulfilled["content-type"] = "text/html; charset=utf-8";
      delete fulfilled["location"];
      delete fulfilled["content-length"];
      return route.fulfill({
        status: 200,
        headers: fulfilled,
        body: `<!doctype html><meta http-equiv="refresh" content="0;url=${escape(next)}">`,
      });
    }
    const whole = {
      status: answer.status,
      headers: fulfilled,
      body: Buffer.from(await answer.arrayBuffer()),
    };
    if (moduleKey !== null && answer.status === 200) modules.set(moduleKey, whole);
    return route.fulfill(whole);
  });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await serveOrigin(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
