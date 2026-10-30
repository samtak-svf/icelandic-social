// @ts-check
import { describe, expect, it } from "vitest";
import {
  commitRows,
  eventRows,
  jobRows,
  lane,
  mergeRows,
  paceRows,
  shapeRows,
  spread,
  stepRows,
  toJob,
} from "../ci-measure.mjs";

const at = (/** @type {number} */ minute) =>
  new Date(Date.UTC(2026, 9, 30, 12, minute)).toISOString();

/**
 * @param {Partial<import("../ci-measure.mjs").ApiRun>} [overrides]
 * @returns {import("../ci-measure.mjs").ApiRun}
 */
const run = (overrides) => ({
  id: 1,
  name: "web",
  event: "pull_request",
  head_branch: "feat/x",
  head_sha: "aaa",
  run_attempt: 1,
  created_at: at(0),
  conclusion: "success",
  ...overrides,
});

/**
 * @param {Partial<import("../ci-measure.mjs").ApiJob>} [overrides]
 * @returns {import("../ci-measure.mjs").ApiJob}
 */
const apiJob = (overrides) => ({
  name: "web",
  run_attempt: 1,
  conclusion: "success",
  created_at: at(1),
  started_at: at(3),
  completed_at: at(13),
  labels: ["ubuntu-latest"],
  ...overrides,
});

/**
 * @param {Partial<import("../ci-measure.mjs").ApiRun>} [runOverrides]
 * @param {Partial<import("../ci-measure.mjs").ApiJob>} [jobOverrides]
 */
const job = (runOverrides, jobOverrides) => {
  const found = toJob(run(runOverrides), apiJob(jobOverrides));
  if (!found) throw new Error("the fixture is a job that ran");
  return found;
};

describe("lane", () => {
  it("reads the lane from the labels, the exclusive Mac before the shared one", () => {
    expect(lane(["self-hosted", "macOS", "ARM64", "samtak-mac", "spjall-exclusive"])).toBe(
      "mac-exclusive",
    );
    expect(lane(["self-hosted", "macOS", "ARM64", "samtak-mac"])).toBe("mac");
    expect(lane(["macos-26"])).toBe("hosted-macos");
    expect(lane(["ubuntu-latest"])).toBe("hosted-linux");
    expect(lane(["something-else"])).toBe("other");
  });
});

describe("spread", () => {
  it("takes the nearest rank, and is all zero on nothing", () => {
    const values = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(spread(values)).toEqual({ n: 10, median: 5, p90: 9, max: 10 });
    expect(spread([])).toEqual({ n: 0, median: 0, p90: 0, max: 0 });
  });
});

describe("toJob", () => {
  it("drops a job that never ran, and one that has not finished", () => {
    expect(toJob(run(), apiJob({ conclusion: "skipped" }))).toBeNull();
    expect(toJob(run(), apiJob({ started_at: null }))).toBeNull();
    expect(toJob(run(), apiJob({ completed_at: null }))).toBeNull();
  });

  it("keeps a step only when it has both ends", () => {
    const found = job(undefined, {
      steps: [
        { name: "Playwright", started_at: at(4), completed_at: at(6), conclusion: "success" },
        { name: "Never ran", started_at: null, completed_at: null, conclusion: "skipped" },
      ],
    });
    expect(found.steps).toEqual([{ name: "Playwright", seconds: 120 }]);
  });
});

describe("jobRows", () => {
  it("splits wait from run per lane and event, and leaves a cancelled job out", () => {
    const rows = jobRows([
      job(),
      job({ event: "push" }),
      job(undefined, { labels: ["samtak-mac"] }),
      job(undefined, { conclusion: "cancelled" }),
    ]);
    expect(rows).toHaveLength(3);
    const hosted = rows.find((row) => row.lane === "hosted-linux" && row.event === "pull_request");
    expect(hosted?.wait.median).toBe(2);
    expect(hosted?.run.median).toBe(10);
    expect(hosted?.total.median).toBe(12);
    expect(hosted?.total.n).toBe(1);
  });

  it("counts the failures of a lane, since a re-run costs more than a slower job", () => {
    const [row] = jobRows([job(), job(undefined, { conclusion: "failure" })]);
    expect(row?.total.n).toBe(2);
    expect(row?.failed).toBe(1);
  });
});

describe("commitRows", () => {
  it("takes the wall from the first run created to the last job completed", () => {
    const rows = commitRows([
      job({ name: "CI", created_at: at(0) }, { name: "check", completed_at: at(5) }),
      job({ name: "web", created_at: at(2) }, { completed_at: at(20) }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wall: 20, pace: "web/web", shape: "CI+web", reruns: 0 });
  });

  it("reads a re-run from its newest attempt, and counts it", () => {
    const rows = commitRows([
      job(undefined, { conclusion: "failure", run_attempt: 1, completed_at: at(10) }),
      job(undefined, { run_attempt: 2, completed_at: at(30) }),
    ]);
    expect(rows[0]?.reruns).toBe(1);
    expect(rows[0]?.wall).toBe(30);
  });

  it("leaves out a commit that was cancelled, and a push", () => {
    expect(commitRows([job(undefined, { conclusion: "cancelled" })])).toEqual([]);
    expect(commitRows([job({ event: "push" })])).toEqual([]);
  });

  it("groups by the job that set the pace and by what ran", () => {
    const commits = commitRows([
      job({ head_sha: "a" }),
      job({ head_sha: "b" }),
      job({ head_sha: "c", name: "ios" }, { name: "build", labels: ["samtak-mac"] }),
    ]);
    expect(paceRows(commits).map((row) => [row.key, row.wall.n])).toEqual([
      ["web/web\thosted-linux", 2],
      ["ios/build\tmac", 1],
    ]);
    expect(shapeRows(commits).map((row) => [row.shape, row.wall.n])).toEqual([
      ["web", 2],
      ["ios", 1],
    ]);
  });
});

describe("eventRows", () => {
  it("counts runs and job minutes per event", () => {
    expect(eventRows([run(), run({ event: "push" })], [job(), job({ event: "push" })])).toEqual([
      { event: "pull_request", runs: 1, jobMinutes: 10, waitMinutes: 2 },
      { event: "push", runs: 1, jobMinutes: 10, waitMinutes: 2 },
    ]);
  });
});

describe("stepRows", () => {
  it("reads only successful jobs, slowest step first", () => {
    const steps = [
      { name: "Fast", started_at: at(3), completed_at: at(4), conclusion: "success" },
      { name: "Slow", started_at: at(4), completed_at: at(9), conclusion: "success" },
    ];
    const rows = stepRows([
      job(undefined, { steps }),
      job(undefined, { steps, conclusion: "failure" }),
    ]);
    expect(
      rows.map((row) => [row.key.split("\t").at(-1), row.seconds.n, row.seconds.median]),
    ).toEqual([
      ["Slow", 1, 300],
      ["Fast", 1, 60],
    ]);
  });
});

describe("mergeRows", () => {
  it("counts a PR merged inside the window, and no other", () => {
    /** @param {number} number @param {string | null} merged */
    const pull = (number, merged) => ({
      number,
      created_at: at(0),
      merged_at: merged,
      head: { ref: "x" },
    });
    const rows = mergeRows(
      [pull(1, at(30)), pull(2, null), pull(3, at(59))],
      Date.parse(at(10)),
      Date.parse(at(40)),
    );
    expect(rows).toEqual([{ number: 1, minutes: 30 }]);
  });
});
