// @ts-check
import { describe, expect, it } from "vitest";
import {
  hasPullRequestTrigger,
  jobMinutes,
  mergeMinutes,
  renderTable,
  summarize,
} from "../ci-timings.mjs";

const at = (/** @type {number} */ minute) =>
  new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString();
const pull = (
  /** @type {number} */ number,
  /** @type {number} */ opened,
  /** @type {number | null} */ merged,
  login = "someone",
) => ({
  number,
  created_at: at(opened),
  merged_at: merged === null ? null : at(merged),
  user: { login },
});

describe("mergeMinutes", () => {
  const pulls = [
    pull(1, 0, 10),
    pull(2, 0, 30),
    pull(3, 0, 20, "dependabot[bot]"),
    pull(4, 0, null),
    pull(5, 5, 50),
  ];
  it("drops dependabot and unmerged PRs", () => {
    expect(mergeMinutes(pulls, 10).sort((a, b) => a - b)).toEqual([10, 30, 45]);
  });
  it("keeps the newest by merge time", () => {
    expect(mergeMinutes(pulls, 2)).toEqual([45, 30]);
  });
});

describe("jobMinutes", () => {
  it("splits queue and run, skipping jobs that never ran", () => {
    const jobs = [
      { created_at: at(0), started_at: at(2), completed_at: at(7), conclusion: "success" },
      { created_at: at(0), started_at: at(4), completed_at: at(5), conclusion: "failure" },
      { created_at: at(0), started_at: null, completed_at: at(1), conclusion: "skipped" },
      { created_at: at(0), started_at: at(1), completed_at: at(9), conclusion: "cancelled" },
    ];
    expect(jobMinutes(jobs)).toEqual({ queue: [2, 4], ran: [5, 1] });
  });
});

describe("summarize", () => {
  it("reports nearest-rank median, p90 and max over 1..10", () => {
    const values = [10, 3, 1, 7, 5, 9, 2, 8, 4, 6];
    expect(summarize({ m: values })).toEqual([{ name: "m", n: 10, median: 5, p90: 9, max: 10 }]);
  });
  it("ranks by ceiling, not by rounding down, when the count is not a multiple of ten", () => {
    // Seven values: median is the 4th (ceil 3.5), p90 the 7th (ceil 6.3).
    expect(summarize({ m: [7, 1, 6, 2, 5, 3, 4] })).toEqual([
      { name: "m", n: 7, median: 4, p90: 7, max: 7 },
    ]);
  });
  it("renders one line per measure under a header", () => {
    const table = renderTable(summarize({ queue: [1, 2, 3] }));
    expect(table.split("\n")).toHaveLength(2);
    expect(table).toMatch(/queue\s+3\s+2\.0\s+3\.0\s+3\.0/);
  });
});

describe("hasPullRequestTrigger", () => {
  it("matches pull_request and not pull_request_target", () => {
    expect(hasPullRequestTrigger("on:\n  pull_request:\n    paths: [a]\n")).toBe(true);
    expect(hasPullRequestTrigger("on: [push, pull_request]\n")).toBe(true);
    expect(hasPullRequestTrigger("on:\n  push:\n  pull_request_target:\n")).toBe(false);
    expect(hasPullRequestTrigger("on:\n  workflow_dispatch:\n")).toBe(false);
  });
});
