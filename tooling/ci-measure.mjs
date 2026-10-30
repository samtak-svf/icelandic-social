// @ts-check
// How long CI takes: the same measure before and after each change to the flow
// (epic #392, #393, #394). Read-only, from the GitHub API.
//
//   node tooling/ci-measure.mjs [--since <ISO>] [--until <ISO>] [--event pull_request|push]
//                               [--workflow <name>] [--steps] [--json <file>]
//
// `--since` defaults to seven days back. The token is GITHUB_TOKEN or `gh auth token`.
//
// What each figure means:
// - wait: job started minus job created, so a job's queue time on its runner.
// - run: job completed minus job started.
// - total: wait plus run, what a lane costs the person waiting on it.
// - whole matrix: one run's `web (1)` and `web (2)` read as `web`, first leg created
//   to last leg completed, since that is what a person waits for. A sharded job
//   compares with its unsharded self only on this figure.
// - commit wall: for one PR head commit, the first run created to the last job
//   completed, in its newest attempt. Cancelled commits do not count: a commit
//   nobody waited for to the end says nothing about the wait.
// - shape: the workflows one commit started, so a figure is read against what a
//   path filter let run.
// A row under MIN_SAMPLE is marked `few`: read it as an anecdote, not a verdict.
// Exit: 0 printed, 1 the window held no finished job, 2 could not run. An empty
// window is a failure of the measure, never a table of zeros.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { render } from "./lib/ci-measure-render.mjs";

const REPO = "samtak-svf/icelandic-social";
const API = "https://api.github.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 8;
const RETRIES = 5;

/**
 * @typedef {{ name: string, started_at: string | null, completed_at: string | null, conclusion: string | null }} ApiStep
 * @typedef {{ name: string, run_attempt: number, conclusion: string | null, created_at: string, started_at: string | null, completed_at: string | null, labels: string[], steps?: ApiStep[] }} ApiJob
 * @typedef {{ id: number, name: string, event: string, head_branch: string | null, head_sha: string, run_attempt: number, created_at: string, conclusion: string | null }} ApiRun
 * @typedef {{ number: number, created_at: string, merged_at: string | null, head: { ref: string } }} ApiPull
 * @typedef {{ workflow: string, job: string, event: string, lane: string, branch: string | null, sha: string, attempt: number, conclusion: string | null, created: number, started: number, completed: number, runCreated: number, steps: { name: string, seconds: number }[] }} Job
 * @typedef {{ n: number, median: number, p90: number, max: number }} Spread
 */

/**
 * Which lane a job ran on, from its labels.
 * @param {string[]} labels
 */
export function lane(labels) {
  const lower = labels.map((label) => label.toLowerCase());
  if (lower.includes("spjall-exclusive")) return "mac-exclusive";
  if (lower.includes("samtak-mac")) return "mac";
  if (lower.some((label) => label.startsWith("macos"))) return "hosted-macos";
  if (lower.some((label) => label.startsWith("ubuntu"))) return "hosted-linux";
  return "other";
}

/**
 * Nearest-rank quantile of a sorted list.
 * @param {number[]} sorted
 * @param {number} q
 */
function quantile(sorted, q) {
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
}

/**
 * @param {number[]} values
 * @returns {Spread}
 */
export function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max: sorted.at(-1) ?? 0,
  };
}

/**
 * A job in the form the figures read, or null when it never ran: a skipped job
 * has no wait, and a job still going has no end.
 * @param {ApiRun} run
 * @param {ApiJob} job
 * @returns {Job | null}
 */
export function toJob(run, job) {
  if (!job.started_at || !job.completed_at || job.conclusion === "skipped") return null;
  const started = Date.parse(job.started_at);
  const completed = Date.parse(job.completed_at);
  if (completed < started) return null;
  return {
    workflow: run.name,
    job: job.name,
    event: run.event,
    lane: lane(job.labels),
    branch: run.head_branch,
    sha: run.head_sha,
    attempt: job.run_attempt,
    conclusion: job.conclusion,
    created: Date.parse(job.created_at),
    started,
    completed,
    runCreated: Date.parse(run.created_at),
    steps: (job.steps ?? []).flatMap((step) =>
      step.started_at && step.completed_at
        ? [
            {
              name: step.name,
              seconds: (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000,
            },
          ]
        : [],
    ),
  };
}

const minutes = (/** @type {number} */ ms) => ms / 60000;

/**
 * The legs of a matrix job read as one job per run: first leg created to last
 * leg completed. A run with a cancelled leg does not count, as in jobRows, and a
 * failed leg fails the whole.
 * @param {Job[]} jobs
 */
export function matrixRows(jobs) {
  /** @type {Map<string, Job[]>} */
  const runs = new Map();
  for (const job of jobs) {
    const base = /^(.+) \([^()]+\)$/.exec(job.job)?.[1];
    if (!base) continue;
    const key = [job.workflow, base, job.lane, job.event, job.runCreated, job.attempt].join("\t");
    runs.set(key, [...(runs.get(key) ?? []), job]);
  }
  /** @type {Map<string, { total: number, legs: number, failed: boolean }[]>} */
  const groups = new Map();
  for (const [key, legs] of runs) {
    if (legs.some((leg) => leg.conclusion !== "success" && leg.conclusion !== "failure")) continue;
    const group = key.split("\t").slice(0, 4).join("\t");
    const first = Math.min(...legs.map((leg) => leg.created));
    const last = Math.max(...legs.map((leg) => leg.completed));
    groups.set(group, [
      ...(groups.get(group) ?? []),
      {
        total: minutes(last - first),
        legs: legs.length,
        failed: legs.some((leg) => leg.conclusion === "failure"),
      },
    ]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [workflow = "", job = "", laneName = "", event = ""] = key.split("\t");
      return {
        workflow,
        job,
        lane: laneName,
        event,
        legs: Math.max(...group.map((row) => row.legs)),
        total: spread(group.map((row) => row.total)),
        failed: group.filter((row) => row.failed).length,
      };
    })
    .sort((a, b) => b.total.median - a.total.median);
}

/**
 * Wait, run and total per workflow, job, lane and event. Only finished jobs
 * count: a cancelled job's run time is when someone gave up.
 * @param {Job[]} jobs
 */
export function jobRows(jobs) {
  /** @type {Map<string, Job[]>} */
  const groups = new Map();
  for (const job of jobs) {
    if (job.conclusion !== "success" && job.conclusion !== "failure") continue;
    const key = [job.workflow, job.job, job.lane, job.event].join("\t");
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [workflow = "", job = "", laneName = "", event = ""] = key.split("\t");
      return {
        workflow,
        job,
        lane: laneName,
        event,
        wait: spread(group.map((j) => minutes(j.started - j.created))),
        run: spread(group.map((j) => minutes(j.completed - j.started))),
        total: spread(group.map((j) => minutes(j.completed - j.created))),
        failed: group.filter((j) => j.conclusion === "failure").length,
      };
    })
    .sort((a, b) => b.total.median - a.total.median);
}

/**
 * One row per PR head commit that was waited for to the end, in its newest
 * attempt: the wall time, the jobs' time inside it and which workflows ran.
 * @param {Job[]} jobs
 */
export function commitRows(jobs) {
  /** @type {Map<string, Job[]>} */
  const commits = new Map();
  for (const job of jobs) {
    if (job.event !== "pull_request") continue;
    commits.set(job.sha, [...(commits.get(job.sha) ?? []), job]);
  }
  return [...commits.entries()].flatMap(([sha, all]) => {
    const newest = new Map();
    for (const job of all) {
      const key = `${job.workflow}\t${job.job}`;
      const seen = newest.get(key);
      if (!seen || job.attempt >= seen.attempt) newest.set(key, job);
    }
    /** @type {Job[]} */
    const latest = [...newest.values()];
    if (latest.some((job) => job.conclusion === "cancelled")) return [];
    const first = Math.min(...latest.map((job) => job.runCreated));
    const last = Math.max(...latest.map((job) => job.completed));
    const slowest = latest.reduce((a, b) => (b.completed > a.completed ? b : a));
    return [
      {
        sha,
        branch: slowest.branch,
        wall: minutes(last - first),
        pace: `${slowest.workflow}/${slowest.job}`,
        paceLane: slowest.lane,
        shape: [...new Set(latest.map((job) => job.workflow))].sort().join("+"),
        reruns: Math.max(...all.map((job) => job.attempt)) - 1,
      },
    ];
  });
}

/**
 * The job that finished last on each commit: what set the pace.
 * @param {ReturnType<typeof commitRows>} commits
 */
export function paceRows(commits) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  for (const row of commits) {
    const key = `${row.pace}\t${row.paceLane}`;
    groups.set(key, [...(groups.get(key) ?? []), row.wall]);
  }
  return [...groups.entries()]
    .map(([key, walls]) => ({ key, wall: spread(walls) }))
    .sort((a, b) => b.wall.n - a.wall.n);
}

/**
 * Commit wall time by the set of workflows that ran.
 * @param {ReturnType<typeof commitRows>} commits
 */
export function shapeRows(commits) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  for (const row of commits) groups.set(row.shape, [...(groups.get(row.shape) ?? []), row.wall]);
  return [...groups.entries()]
    .map(([shape, walls]) => ({ shape, wall: spread(walls) }))
    .sort((a, b) => b.wall.n - a.wall.n);
}

/**
 * Runs and job minutes per event, for the share #394 asks about.
 * @param {ApiRun[]} runs
 * @param {Job[]} jobs
 */
export function eventRows(runs, jobs) {
  /** @type {Map<string, { runs: number, jobMinutes: number, waitMinutes: number }>} */
  const events = new Map();
  const row = (/** @type {string} */ event) => {
    const found = events.get(event) ?? { runs: 0, jobMinutes: 0, waitMinutes: 0 };
    events.set(event, found);
    return found;
  };
  for (const run of runs) row(run.event).runs += 1;
  for (const job of jobs) {
    const found = row(job.event);
    found.jobMinutes += minutes(job.completed - job.started);
    found.waitMinutes += minutes(job.started - job.created);
  }
  return [...events.entries()].map(([event, value]) => ({ event, ...value }));
}

/**
 * Median seconds per step of each job, on one lane: where a cache would pay.
 * @param {Job[]} jobs
 */
export function stepRows(jobs) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  for (const job of jobs) {
    if (job.conclusion !== "success") continue;
    for (const step of job.steps) {
      const key = [job.workflow, job.job, job.lane, step.name].join("\t");
      groups.set(key, [...(groups.get(key) ?? []), step.seconds]);
    }
  }
  return [...groups.entries()]
    .map(([key, seconds]) => ({ key, seconds: spread(seconds) }))
    .sort((a, b) => b.seconds.median - a.seconds.median);
}

/**
 * Open to merge per PR, in minutes.
 * @param {ApiPull[]} pulls
 * @param {number} since
 * @param {number} until
 */
export function mergeRows(pulls, since, until) {
  return pulls.flatMap((pull) => {
    if (!pull.merged_at) return [];
    const merged = Date.parse(pull.merged_at);
    if (merged < since || merged > until) return [];
    return [{ number: pull.number, minutes: minutes(merged - Date.parse(pull.created_at)) }];
  });
}

/**
 * A long window is thousands of calls, and the API answers a few of them with a
 * 502 or a secondary rate limit: those are retried, anything else is an error.
 * @param {string} path
 * @param {number} [retries]
 * @param {number} [attempt]
 * @returns {Promise<{ body: any, next: string | undefined }>}
 */
async function getJson(path, retries = RETRIES, attempt = 0) {
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    headers: {
      authorization: `Bearer ${token()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  const passing = response.status >= 500 || response.status === 403 || response.status === 429;
  if (!response.ok && passing && attempt < retries) {
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 2000));
    return getJson(path, retries, attempt + 1);
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
  return { body: await response.json(), next };
}

/** @type {string | undefined} */
let cachedToken;
function token() {
  cachedToken ??=
    process.env.GITHUB_TOKEN ||
    execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  return cachedToken;
}

/**
 * Every page of a list endpoint.
 * @param {string} path
 * @param {(body: any) => any[]} items
 */
async function allPages(path, items) {
  /** @type {any[]} */
  const found = [];
  /** @type {string | undefined} */
  let next = path;
  while (next) {
    const page = /** @type {{ body: any, next: string | undefined }} */ (await getJson(next));
    found.push(...items(page.body));
    next = page.next;
  }
  return found;
}

/**
 * The runs of a window, a day at a time: the search behind `created=` returns at
 * most 1000, and a busy week here is more than that.
 * @param {string} repo
 * @param {number} since
 * @param {number} until
 * @returns {Promise<ApiRun[]>}
 */
async function fetchRuns(repo, since, until) {
  /** @type {ApiRun[]} */
  const runs = [];
  for (let from = since; from < until; from += DAY_MS) {
    const to = Math.min(from + DAY_MS - 1000, until);
    const range = `${new Date(from).toISOString()}..${new Date(to).toISOString()}`;
    runs.push(
      ...(await allPages(
        `/repos/${repo}/actions/runs?per_page=100&created=${encodeURIComponent(range)}`,
        (body) => body.workflow_runs,
      )),
    );
  }
  return runs;
}

/**
 * A run's jobs. On 2026-10-30 this endpoint answered 502 to every page of more
 * than one job on a multi-job run, repeatably, while `per_page=1` always worked,
 * so a refused page falls back to walking the jobs one at a time.
 * @param {string} repo
 * @param {number} runId
 * @returns {Promise<ApiJob[]>}
 */
async function fetchJobs(repo, runId) {
  const base = `/repos/${repo}/actions/runs/${runId}/jobs?filter=all`;
  try {
    const first = await getJson(`${base}&per_page=100`, 0);
    if (!first.next) return first.body.jobs;
  } catch {
    // Walked below.
  }
  /** @type {ApiJob[]} */
  const jobs = [];
  for (let page = 1; ; page++) {
    const { body } = await getJson(`${base}&per_page=1&page=${page}`);
    if (body.jobs.length === 0) return jobs;
    jobs.push(...body.jobs);
  }
}

/**
 * @template T, U
 * @param {T[]} items
 * @param {(item: T) => Promise<U>} work
 * @returns {Promise<U[]>}
 */
async function pool(items, work) {
  /** @type {U[]} */
  const results = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (index < items.length) {
        const item = /** @type {T} */ (items[index++]);
        results.push(await work(item));
      }
    }),
  );
  return results;
}

/**
 * Every figure, from the API's records.
 * @param {{ since: number, until: number, runs: ApiRun[], jobs: Job[], pulls: ApiPull[] }} input
 */
export function report({ since, until, runs, jobs, pulls }) {
  const commits = commitRows(jobs);
  return {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    runs: runs.length,
    jobs: jobs.length,
    events: eventRows(runs, jobs),
    jobRows: jobRows(jobs),
    matrixRows: matrixRows(jobs),
    wall: spread(commits.map((row) => row.wall)),
    rerunCommits: commits.filter((row) => row.reruns > 0).length,
    pace: paceRows(commits),
    shapes: shapeRows(commits),
    steps: stepRows(jobs),
    merge: spread(mergeRows(pulls, since, until).map((row) => row.minutes)),
  };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--steps") options.steps = true;
    else if (["--since", "--until", "--event", "--workflow", "--json", "--repo"].includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = typeof options.repo === "string" ? options.repo : REPO;
  const until = typeof options.until === "string" ? Date.parse(options.until) : Date.now();
  const since = typeof options.since === "string" ? Date.parse(options.since) : until - 7 * DAY_MS;
  if (Number.isNaN(since) || Number.isNaN(until))
    throw new Error("--since and --until take a date");

  let runs = await fetchRuns(repo, since, until);
  if (typeof options.event === "string") runs = runs.filter((run) => run.event === options.event);
  if (typeof options.workflow === "string")
    runs = runs.filter((run) => run.name === options.workflow);

  const perRun = await pool(runs, async (run) => {
    const apiJobs = await fetchJobs(repo, run.id);
    return apiJobs.flatMap((job) => toJob(run, job) ?? []);
  });
  const jobs = perRun.flat();
  if (jobs.length === 0) {
    console.error(
      `no finished job between ${new Date(since).toISOString()} and ${new Date(until).toISOString()}`,
    );
    process.exit(1);
  }

  // Newest first, so the walk can stop once a page is older than the window.
  /** @type {ApiPull[]} */
  const pulls = [];
  /** @type {string | undefined} */
  let next = `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;
  while (next) {
    const page = /** @type {{ body: ApiPull[], next: string | undefined }} */ (await getJson(next));
    pulls.push(...page.body);
    const oldest = page.body.at(-1);
    next = oldest && Date.parse(oldest.created_at) > since - 30 * DAY_MS ? page.next : undefined;
  }

  const data = report({ since, until, runs, jobs, pulls });
  if (typeof options.json === "string")
    writeFileSync(options.json, `${JSON.stringify(data, null, 2)}\n`);
  console.log(render(data, options.steps === true));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });
}
