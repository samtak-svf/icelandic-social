import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { belowFloor } from "../src/client-version.ts";
import { device } from "./support.ts";
import { bareWorker } from "./main.ts";

// The client version floor (decision 0030): Spjall-Client on every /v1
// request, a build below its platform's floor told to update, a request
// without the header taken as 0.1.0, below the 0.2.0 floor.

const BASE = "https://spjall.test";
const fetch = (path: string, headers: Record<string, string>) =>
  bareWorker.fetch(`${BASE}${path}`, { headers });

const floors = (android: string, ios: string) =>
  ({ ...env, MIN_CLIENT_VERSION_ANDROID: android, MIN_CLIENT_VERSION_IOS: ios }) as Env;

describe("the client version floor", () => {
  it("lets in a build at or above its platform's floor, compared by number", () => {
    const at = floors("0.2.0", "0.9.0");
    expect(belowFloor(at, "android/0.2.0")).toBeNull();
    expect(belowFloor(at, "android/0.10.0")).toBeNull();
    expect(belowFloor(at, "ios/1.0.0")).toBeNull();
    expect(belowFloor(at, "ios/0.10.0")).toBeNull();
  });

  it("tells a build below the floor which version to update to", () => {
    const at = floors("0.2.0", "0.9.0");
    expect(belowFloor(at, "android/0.1.9")).toEqual({
      error: "client_too_old",
      minVersion: "0.2.0",
    });
    expect(belowFloor(at, "ios/0.8.12")).toEqual({ error: "client_too_old", minVersion: "0.9.0" });
  });

  it("takes a request without the header as 0.1.0 on the higher floor", () => {
    expect(belowFloor(floors("0.1.0", "0.1.0"), undefined)).toBeNull();
    expect(belowFloor(floors("0.1.0", "0.2.0"), undefined)).toEqual({
      error: "client_too_old",
      minVersion: "0.2.0",
    });
  });

  it.each(["android", "android/0.2", "web/1.0.0", "android/0.2.0-beta", "ios/ 0.2.0"])(
    "refuses a malformed header %j",
    (header) => {
      expect(belowFloor(floors("0.1.0", "0.1.0"), header)).toEqual({ error: "invalid_request" });
    },
  );

  it("answers 426 on a /v1 route, before the token is looked at, and leaves /health open", async () => {
    const owner = await device();
    const tooOld = { error: "client_too_old", minVersion: "0.2.0", requestId: expect.any(String) };
    const old = await fetch("/v1/me", { ...owner.auth, "spjall-client": "android/0.1.0" });
    expect(old.status).toBe(426);
    expect(await old.json()).toEqual(tooOld);
    // A build from before the header counts as 0.1.0, so the 0.2.0 floor shuts it out.
    const unnamed = await fetch("/v1/me", owner.auth);
    expect(unnamed.status).toBe(426);
    expect(await unnamed.json()).toEqual(tooOld);
    expect((await fetch("/v1/me", { "spjall-client": "ios/0.1.9" })).status).toBe(426);
    expect((await fetch("/v1/me", { ...owner.auth, "spjall-client": "x" })).status).toBe(400);

    for (const build of ["android/0.2.0", "ios/0.2.0", "ios/0.10.0"])
      expect((await fetch("/v1/me", { ...owner.auth, "spjall-client": build })).status).toBe(200);
    expect((await fetch("/health", {})).status).toBe(200);
    expect((await fetch("/health", { "spjall-client": "android/0.0.9" })).status).toBe(200);
  });
});
