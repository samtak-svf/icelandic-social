// @ts-check
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  madeUpKennitala,
  pageFault,
  pagePlan,
  percentile,
  refusal,
  spread,
} from "../home-measure.mjs";

const PROD = ["spjall.samtak.is"];
const SCRIPT = fileURLToPath(new URL("../home-measure.mjs", import.meta.url));

describe("the origin it will measure", () => {
  it.each([
    ["https://spjall.samtak.is", "gate"],
    ["https://SPJALL.samtak.is", "gate"],
    ["https://spjall.samtak.is.", "gate"],
    ["https://spjall.samtak.is:8443", "gate"],
    ["http://spjall.samtak.is", undefined],
  ])("refuses production at %s", (origin, gate) => {
    expect(refusal(origin, gate, PROD)).toBe("STAGING_ORIGIN is a production host");
  });

  it("refuses no origin, a bad one, plain http, and a remote one with no gate", () => {
    expect(refusal(undefined, "gate", PROD)).toMatch(/not set/);
    expect(refusal("nowhere", "gate", PROD)).toMatch(/not a URL/);
    expect(refusal("http://staging.example", "gate", PROD)).toMatch(/https/);
    expect(refusal("https://staging.example", undefined, PROD)).toMatch(/STAGING_GATE/);
  });

  it("takes a gated https origin, and loopback with no gate", () => {
    expect(refusal("https://staging.example", "gate", PROD)).toBeNull();
    expect(refusal("http://localhost:8787", undefined, PROD)).toBeNull();
    expect(refusal("http://127.0.0.1:8787", undefined, PROD)).toBeNull();
  });

  it("never prints the address it refused", () => {
    const secret = "http://secret-staging.example";
    const run = spawnSync(process.execPath, [SCRIPT, "--run", "t"], {
      env: { ...process.env, STAGING_ORIGIN: secret, STAGING_GATE: "the-gate" },
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/https/);
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/secret-staging|the-gate/);
  });

  it("stops at production before any request", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--run", "t"], {
      env: { ...process.env, STAGING_ORIGIN: "https://spjall.samtak.is", STAGING_GATE: "g" },
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/production host/);
  });

  it("wants a run label", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--run/);
  });
});

describe("the figures", () => {
  const hundred = Array.from({ length: 100 }, (_, n) => n + 1);

  it("takes a real sample at each rank", () => {
    expect(percentile(hundred, 0.5)).toBe(50);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("is the slowest at p95 of ten", () => {
    const ten = hundred.slice(0, 10);
    expect(spread(ten)).toEqual({ samples: 10, p50: 5, p95: 10, max: 10 });
  });

  it("refuses to make a figure of nothing", () => {
    expect(() => percentile([], 0.5)).toThrow(/nothing/);
  });
});

describe("the page it measures", () => {
  const posts = (/** @type {string[]} */ ...ids) => ids.map((communityId) => ({ communityId }));

  it("takes a page of its length in as many spaces", () => {
    expect(pageFault(posts("a", "b", "c"), 3)).toBeNull();
  });

  it("refuses a short page and an empty one", () => {
    expect(pageFault(posts("a"), 3)).toMatch(/1 posts/);
    expect(pageFault([], 3)).toMatch(/0 posts/);
  });

  it("refuses a page in fewer spaces, which would flatter the figure", () => {
    expect(pageFault(posts("a", "a", "b"), 3)).toMatch(/in 2 spaces/);
  });

  it("is written half on walls and half in communities, each by one friend", () => {
    expect(pagePlan(30, 500, 50)).toEqual({ walls: 15, inCommunities: 15 });
    expect(pagePlan(15, 500, 50)).toEqual({ walls: 8, inCommunities: 7 });
    expect(pagePlan(30, 500, 3)).toEqual({ walls: 27, inCommunities: 3 });
  });

  it("says when the friends cannot write it", () => {
    expect(pagePlan(30, 10, 50)).toBeNull();
  });
});

describe("a made-up kennitala", () => {
  it("passes the check digit, whatever the seed", () => {
    const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
    for (let seed = 0; seed < 500; seed++) {
      const made = madeUpKennitala(seed);
      expect(made).toMatch(/^\d{6}\d{2}\d0$/);
      const sum = WEIGHTS.reduce((total, weight, at) => total + weight * Number(made[at]), 0);
      expect((sum + Number(made[8])) % 11).toBe(0);
      expect(made.slice(4, 6)).toBe("99");
    }
  });
});
