import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { versionPerPlatform } from "../src/api/health.ts";
import { belowFloorOf } from "../src/client-version.ts";
import { minClientVersions } from "../src/env/index.ts";
import { CLIENTS, PLATFORMS } from "../src/platforms.ts";

// Platforms come from one list (src/platforms.ts): a third one is one line
// there, a var in cloudflare.config.ts and a migration that widens the CHECK.
// The web is a client of the floor and not a platform: it is never a device.

describe("the platform list", () => {
  it("is what the schemas, the floors and the header follow, so a third platform is one entry", () => {
    const platforms = [...PLATFORMS, "desktop"] as const;
    expect(z.enum(platforms).parse("desktop")).toBe("desktop");
    const floors = versionPerPlatform(platforms).parse({
      android: "0.5.0",
      ios: "0.5.0",
      desktop: "0.9.0",
    });
    expect(belowFloorOf(floors, "desktop/0.9.0")).toBeNull();
    expect(belowFloorOf(floors, "desktop/0.8.9")).toEqual({
      error: "client_too_old",
      minVersion: "0.9.0",
    });
    // A request without the header meets the highest app floor, now desktop's.
    expect(belowFloorOf(floors, undefined)).toEqual({
      error: "client_too_old",
      minVersion: "0.9.0",
    });
    // The list as it is still refuses the platform it lacks.
    expect(belowFloorOf(minClientVersions(env), "desktop/0.9.0")).toEqual({
      error: "invalid_request",
    });
    expect(z.enum(PLATFORMS).safeParse("desktop").success).toBe(false);
  });

  it("is every client the floor knows but the web, which is never a device", () => {
    expect(CLIENTS).toEqual([...PLATFORMS, "web"]);
    expect(z.enum(PLATFORMS).safeParse("web").success).toBe(false);
  });

  it("has a minimum version for every client", () => {
    expect(Object.keys(minClientVersions(env))).toEqual([...CLIENTS]);
    for (const floor of Object.values(minClientVersions(env)))
      expect(floor).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the D1 CHECK on devices.platform, as the latest migration that sets it leaves it", () => {
    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const checks = TEST_MIGRATIONS.flatMap((m) => m.queries).flatMap((query) => [
      ...query.matchAll(/CHECK\s*\(\s*platform\s+IN\s*\(([^)]*)\)\s*\)/gi),
    ]);
    const latest = checks.at(-1)?.[1];
    expect(latest?.split(",").map((name) => name.trim().replaceAll("'", ""))).toEqual([
      ...PLATFORMS,
    ]);
  });
});
