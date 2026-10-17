import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { versionPerPlatform } from "../src/api/health.ts";
import { belowFloorOf } from "../src/client-version.ts";
import { minClientVersions } from "../src/env/index.ts";
import { PLATFORMS } from "../src/platforms.ts";

// Platforms come from one list (src/platforms.ts): a third one is one line
// there, a var in cloudflare.config.ts and a migration that widens the CHECK.

describe("the platform list", () => {
  it("is what the schemas, the floors and the header follow, so a third platform is one entry", () => {
    const platforms = [...PLATFORMS, "web"] as const;
    expect(z.enum(platforms).parse("web")).toBe("web");
    const floors = versionPerPlatform(platforms).parse({
      android: "0.5.0",
      ios: "0.5.0",
      web: "0.9.0",
    });
    expect(belowFloorOf(floors, "web/0.9.0")).toBeNull();
    expect(belowFloorOf(floors, "web/0.8.9")).toEqual({
      error: "client_too_old",
      minVersion: "0.9.0",
    });
    // A request without the header meets the highest floor, now web's.
    expect(belowFloorOf(floors, undefined)).toEqual({
      error: "client_too_old",
      minVersion: "0.9.0",
    });
    // The list as it is still refuses the platform it lacks.
    expect(belowFloorOf(minClientVersions(env), "web/0.9.0")).toEqual({ error: "invalid_request" });
    expect(z.enum(PLATFORMS).safeParse("web").success).toBe(false);
  });

  it("has a minimum version for every entry", () => {
    expect(Object.keys(minClientVersions(env))).toEqual([...PLATFORMS]);
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
