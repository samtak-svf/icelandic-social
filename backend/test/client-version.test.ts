import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { belowFloor } from "../src/client-version.ts";
import { updateUrls } from "../src/env/index.ts";
import { brandStrings } from "../src/brand.gen.ts";
import { device } from "./support.ts";
import { bareWorker } from "./main.ts";

// The client version floor (decision 0030): Spjall-Client on every /v1
// request, a build below its platform's floor told to update, a request
// without the header taken as 0.1.0, below the 0.2.0 floor.

const BASE = "https://spjall.test";
const fetch = (path: string, headers: Record<string, string>) =>
  bareWorker.fetch(`${BASE}${path}`, { headers });

const ANDROID_URL = "https://play.google.com/apps/internaltest/4701643324608289838";
const IOS_URL = "itms-beta://";

const withVars = (vars: Record<string, string>) => ({ ...env, ...vars }) as unknown as Env;

const floors = (android: string, ios: string, web = "0.1.0") =>
  withVars({
    MIN_CLIENT_VERSION_ANDROID: android,
    MIN_CLIENT_VERSION_IOS: ios,
    MIN_CLIENT_VERSION_WEB: web,
  });

describe("the client version floor", () => {
  it("lets in a build at or above its platform's floor, compared by number", () => {
    const at = floors("0.2.0", "0.9.0");
    expect(belowFloor(at, "android/0.2.0")).toBeNull();
    expect(belowFloor(at, "android/0.10.0")).toBeNull();
    expect(belowFloor(at, "ios/1.0.0")).toBeNull();
    expect(belowFloor(at, "ios/0.10.0")).toBeNull();
  });

  it("tells a build below the floor which version to update to, and where to get it", () => {
    const at = floors("0.2.0", "0.9.0");
    expect(belowFloor(at, "android/0.1.9")).toEqual({
      error: "client_too_old",
      minVersion: "0.2.0",
      updateUrl: ANDROID_URL,
    });
    expect(belowFloor(at, "ios/0.8.12")).toEqual({
      error: "client_too_old",
      minVersion: "0.9.0",
      updateUrl: IOS_URL,
    });
  });

  it("publishes the update URL per platform, and an override replaces it", () => {
    expect(updateUrls(env)).toEqual({ android: ANDROID_URL, ios: IOS_URL });
    const overridden = withVars({ UPDATE_URL_ANDROID: "https://example.test/android" });
    expect(updateUrls(overridden)).toEqual({
      android: "https://example.test/android",
      ios: IOS_URL,
    });
    const raised = withVars({
      UPDATE_URL_ANDROID: "https://example.test/android",
      MIN_CLIENT_VERSION_ANDROID: "0.2.0",
    });
    expect(belowFloor(raised, "android/0.1.9")).toEqual({
      error: "client_too_old",
      minVersion: "0.2.0",
      updateUrl: "https://example.test/android",
    });
  });

  it("falls back to the brand's Android link and TestFlight when a URL is unset", () => {
    expect(updateUrls(withVars({ UPDATE_URL_ANDROID: "", UPDATE_URL_IOS: "" }))).toEqual({
      android: brandStrings.update_url_android,
      ios: "itms-beta://",
    });
  });

  it("takes a request without the header as 0.1.0 on the higher floor", () => {
    expect(belowFloor(floors("0.1.0", "0.1.0"), undefined)).toBeNull();
    expect(belowFloor(floors("0.1.0", "0.2.0"), undefined)).toEqual({
      error: "client_too_old",
      minVersion: "0.2.0",
    });
  });

  it("tells a web tab older than the build the Worker serves to reload, apart from the apps", () => {
    const at = floors("0.2.0", "0.2.0", "1.3.0");
    expect(belowFloor(at, "web/1.3.0")).toBeNull();
    expect(belowFloor(at, "web/1.2.9")).toEqual({ error: "client_too_old", minVersion: "1.3.0" });
    expect(belowFloor(at, "android/0.2.0")).toBeNull();
    // Only an app leaves the header out, so the web's floor is not its floor.
    expect(belowFloor(floors("0.1.0", "0.1.0", "1.3.0"), undefined)).toBeNull();
  });

  it.each(["android", "android/0.2", "desktop/1.0.0", "android/0.2.0-beta", "ios/ 0.2.0"])(
    "refuses a malformed header %j",
    (header) => {
      expect(belowFloor(floors("0.1.0", "0.1.0"), header)).toEqual({ error: "invalid_request" });
    },
  );

  it("answers 426 on a /v1 route, before the token is looked at, and leaves /health open", async () => {
    const owner = await device();
    const tooOld = { error: "client_too_old", minVersion: "0.5.0", requestId: expect.any(String) };
    const old = await fetch("/v1/me", { ...owner.auth, "spjall-client": "android/0.1.0" });
    expect(old.status).toBe(426);
    expect(await old.json()).toEqual({ ...tooOld, updateUrl: ANDROID_URL });
    // A build from before the header counts as 0.1.0, so the 0.5.0 floor shuts it out,
    // and an unnamed request names no platform to give a URL for.
    const unnamed = await fetch("/v1/me", owner.auth);
    expect(unnamed.status).toBe(426);
    expect(await unnamed.json()).toEqual(tooOld);
    const iosOld = await fetch("/v1/me", { "spjall-client": "ios/0.4.9" });
    expect(iosOld.status).toBe(426);
    expect(await iosOld.json()).toEqual({ ...tooOld, updateUrl: IOS_URL });
    expect((await fetch("/v1/me", { ...owner.auth, "spjall-client": "x" })).status).toBe(400);

    for (const build of ["android/0.5.0", "ios/0.5.0", "ios/0.10.0"])
      expect((await fetch("/v1/me", { ...owner.auth, "spjall-client": build })).status).toBe(200);
    expect((await fetch("/health", {})).status).toBe(200);
    expect((await fetch("/health", { "spjall-client": "android/0.0.9" })).status).toBe(200);
  });
});
