// @ts-check
// PR and CI timings, measured the same way every time (#392). Read-only: `gh api` only.
// The method is RECONSTRUCTED: the first measurements were never written down, so this
// is the closest definition that reproduces their shape, not a replay of them.
//
//   node tooling/ci-timings.mjs [--limit 60] [--workflow ci.yml]... [--json]
//
// Measures, each as count, median, p90 and max in minutes (nearest-rank, as ci-measure):
// - open-to-merge: createdAt to mergedAt of the newest merged PRs into main, dependabot
//   excluded (`--limit` PRs, default 60).
// - queue: a job's started_at minus created_at, over the newest `--limit` successful runs
//   of each workflow (any event); a job that never started or was skipped has no figure.
// - ran: a job's completed_at minus started_at, over the same runs.
// Workflows: every file under .github/workflows with a `pull_request` trigger, unless
// `--workflow <file>` names them (repeatable). For a window of time and per-job rows,
// use ci-measure.mjs.
// Exit: 0 printed, 1 a measure had no data, 2 could not run.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { spread } from "./ci-measure.mjs";

const DEFAULT_LIMIT = 60;
const WORKFLOWS_DIR = ".github/workflows";
const MINUTE_MS = 60000;

/**
 * @typedef {{ number: number, created_at: string, merged_at: string | null, user: { login: string } | null }} Pull
 * @typedef {{ created_at: string, started_at: string | null, completed_at: string | null, conclusion: string | null }} ApiJob
 */

/**
 * Minutes between two ISO timestamps.
 * @param {string} from
 * @param {string} to
 */
const between = (from, to) => (Date.parse(to) - Date.parse(from)) / MINUTE_MS;

/**
 * Open-to-merge minutes of the newest `limit` merged PRs, dependabot excluded.
 * @param {Pull[]} pulls
 * @param {number} limit
 */
export function mergeMinutes(pulls, limit) {
  return pulls
    .flatMap((pull) =>
      pull.merged_at && pull.user?.login !== "dependabot[bot]"
        ? [{ merged: pull.merged_at, minutes: between(pull.created_at, pull.merged_at) }]
        : [],
    )
    .sort((a, b) => Date.parse(b.merged) - Date.parse(a.merged))
    .slice(0, limit)
    .map((row) => row.minutes);
}

/**
 * Queue and run minutes of the jobs that ran to an end.
 * @param {ApiJob[]} jobs
 */
export function jobMinutes(jobs) {
  /** @type {{ queue: number[], ran: number[] }} */
  const out = { queue: [], ran: [] };
  for (const job of jobs) {
    if (!job.started_at || !job.completed_at) continue;
    if (job.conclusion !== "success" && job.conclusion !== "failure") continue;
    out.queue.push(between(job.created_at, job.started_at));
    out.ran.push(between(job.started_at, job.completed_at));
  }
  return out;
}

/**
 * Whether a workflow file triggers on pull requests (`pull_request`, not
 * `pull_request_target`).
 * @param {string} text
 */
export function hasPullRequestTrigger(text) {
  return /^\s*pull_request\s*:|^on:\s*\[[^\]]*\bpull_request\b(?!_)[^\]]*\]|^on:\s*pull_request\s*$/m.test(
    text,
  );
}

/**
 * One table row per measure: count, median, p90, max in minutes.
 * @param {Record<string, number[]>} measures
 */
export function summarize(measures) {
  return Object.entries(measures).map(([name, values]) => ({ name, ...spread(values) }));
}

/**
 * @param {ReturnType<typeof summarize>} rows
 */
export function renderTable(rows) {
  const width = Math.max(7, ...rows.map((row) => row.name.length));
  const fmt = (/** @type {number} */ n) => n.toFixed(1).padStart(8);
  const head = `${"measure".padEnd(width)}  ${"count".padStart(5)}${"median".padStart(8)}${"p90".padStart(8)}${"max".padStart(8)}`;
  const lines = rows.map(
    (row) =>
      `${row.name.padEnd(width)}  ${String(row.n).padStart(5)}${fmt(row.median)}${fmt(row.p90)}${fmt(row.max)}`,
  );
  return [head, ...lines].join("\n");
}

/** @param {string[]} args */
function gh(args) {
  return JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 1 << 28 }));
}

/**
 * A run's jobs. The jobs endpoint has refused a page of several jobs with a 502 (2026-10-30),
 * so a refused page falls back to walking them one at a time.
 * @param {number} runId
 * @returns {ApiJob[]}
 */
function fetchJobs(runId) {
  const base = `repos/{owner}/{repo}/actions/runs/${runId}/jobs?filter=latest`;
  try {
    const page = gh([`${base}&per_page=100`]);
    if (page.jobs.length < 100) return page.jobs;
  } catch {
    // Walked below.
  }
  /** @type {ApiJob[]} */
  const jobs = [];
  for (let page = 1; ; page++) {
    const body = gh([`${base}&per_page=1&page=${page}`]);
    if (body.jobs.length === 0) return jobs;
    jobs.push(...body.jobs);
  }
}

/** @param {number} limit */
function fetchMerged(limit) {
  /** @type {Pull[]} */
  const pulls = [];
  for (let page = 1; page <= 20; page++) {
    const body = gh([
      `repos/{owner}/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`,
    ]);
    pulls.push(...body);
    if (body.length < 100 || mergeMinutes(pulls, Infinity).length >= limit * 2) break;
  }
  return pulls;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ limit: number, json: boolean, workflows: string[] }} */
  const options = { limit: DEFAULT_LIMIT, json: false, workflows: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--workflow") options.workflows.push(String(argv[++i]));
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1)
    throw new Error("--limit takes a positive integer");
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workflows = options.workflows.length
    ? options.workflows
    : readdirSync(WORKFLOWS_DIR)
        .filter((file) => /\.ya?ml$/.test(file))
        .filter((file) => hasPullRequestTrigger(readFileSync(`${WORKFLOWS_DIR}/${file}`, "utf8")));
  /** @type {Record<string, number[]>} */
  const measures = { "open-to-merge": mergeMinutes(fetchMerged(options.limit), options.limit) };
  for (const file of workflows) {
    const { workflow_runs: runs } = gh([
      `repos/{owner}/{repo}/actions/workflows/${file}/runs?status=success&per_page=${options.limit}`,
    ]);
    /** @type {{ queue: number[], ran: number[] }} */
    const all = { queue: [], ran: [] };
    for (const run of runs.slice(0, options.limit)) {
      const found = jobMinutes(fetchJobs(run.id));
      all.queue.push(...found.queue);
      all.ran.push(...found.ran);
    }
    measures[`queue ${file}`] = all.queue;
    measures[`ran ${file}`] = all.ran;
  }
  const empty = Object.entries(measures).filter(([, values]) => values.length === 0);
  const rows = summarize(measures);
  console.log(options.json ? JSON.stringify(rows, null, 2) : renderTable(rows));
  if (empty.length) {
    console.error(`no data for: ${empty.map(([name]) => name).join(", ")}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
