// @ts-check
// A merged core to a branch ready for the apps PR, in one command (#395, decision 0013).
//
//   node tooling/core-release.mjs <version> [--app <X.Y.Z>]
//
// 1. Refuses unless main's core/Cargo.toml says <version>, and any existing tag
//    for it is a commit on main with that version.
// 2. Tags that commit and pushes the tag, through the same hooks as by hand, then
//    waits for core.yml to publish the release.
// 3. Writes the release's digests into core/artifact.lock.json. GitHub computes
//    each digest from the stored bytes, the same bytes `cargo xtask fetch` checks.
// 4. Sets versionName and MARKETING_VERSION on a branch off main and commits. The
//    apps PR carries the feature code too, so the branch is left for it, unpushed.
//    --app names the app version; without it, the next patch after main's.
//
// Every step reads what is already there before acting, so the same command after
// a stop, a failed run or a re-run finishes the release with no second tag.
// Nothing here uploads to a store. Exit: 0 the branch is ready, 1 refused or failed.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { lockProblems } from "./core-guard.mjs";
import { ROOT, git } from "./lib/repo.mjs";

const REPO = "samtak-svf/icelandic-social";
const LOCK = "core/artifact.lock.json";
const CARGO = "core/Cargo.toml";
const GRADLE = "android/app/build.gradle.kts";
const XCODEGEN = "ios/project.yml";
const SEMVER = /^\d+\.\d+\.\d+$/;
const POLL_MS = 30_000;
/** Far above the 35 minutes of the slowest core.yml seen; a hung run must not wait forever. */
const TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * @typedef {{ name: string, digest?: string | null }} Asset
 * @typedef {{ status: string, conclusion: string | null, html_url: string }} Run
 * @typedef {{ release: (tag: string) => { assets: Asset[] } | null, runs: (tag: string) => Run[] }} GitHub
 */

/** @param {string} cargoToml */
export function coreVersion(cargoToml) {
  const found = /^\[workspace\.package\]$[^[]*?^version = "([^"]+)"$/m.exec(cargoToml);
  if (!found?.[1]) throw new Error(`${CARGO}: no version under [workspace.package]`);
  return found[1];
}

/** @param {string} version */
export function nextPatch(version) {
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${Number(patch) + 1}`;
}

/**
 * The lock for a release: its version and digests, and everything else as it was.
 * @param {any} lock
 * @param {string} version
 * @param {Asset[]} assets
 */
export function lockFor(lock, version, assets) {
  /** @type {Record<string, { file: string, sha256: string }>} */
  const artifacts = {};
  for (const [platform, artifact] of Object.entries(lock.artifacts)) {
    const { file } = /** @type {{ file: string }} */ (artifact);
    const digest = assets.find((asset) => asset.name === file)?.digest;
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(digest ?? "")?.[1];
    if (!sha256) throw new Error(`the release has no SHA-256 digest for ${file}`);
    artifacts[platform] = { file, sha256 };
  }
  const next = { ...lock, version, artifacts };
  const problems = lockProblems(next);
  if (problems.length > 0) throw new Error(`the new lock is invalid: ${problems.join("; ")}`);
  return next;
}

/**
 * @param {string} text
 * @param {RegExp} pattern one capture before the version, one after
 * @param {string} version
 * @param {string} path
 */
function setOnce(text, pattern, version, path) {
  const matches = text.match(new RegExp(pattern, "gm"));
  if (matches?.length !== 1) {
    throw new Error(`${path}: expected one app version line, found ${matches?.length ?? 0}`);
  }
  return text.replace(new RegExp(pattern, "m"), `$1${version}$2`);
}

/** @type {RegExp} */
const GRADLE_VERSION = /^(\s*versionName = ")[^"]+(")$/;
/** @type {RegExp} */
const XCODEGEN_VERSION = /^(\s*MARKETING_VERSION: ")[^"]+(")$/;

/** @param {string} text @param {string} version */
export const setGradleVersion = (text, version) => setOnce(text, GRADLE_VERSION, version, GRADLE);

/** @param {string} text @param {string} version */
export const setXcodegenVersion = (text, version) =>
  setOnce(text, XCODEGEN_VERSION, version, XCODEGEN);

/**
 * The commit a release tags: the one the tag already names, or main's tip.
 * @param {{ version: string, root: string, tagSha: string | null }} options
 */
function releaseCommit({ version, root, tagSha }) {
  const sha = tagSha ?? git(["rev-parse", "origin/main"], root).trim();
  if (tagSha) {
    try {
      git(["merge-base", "--is-ancestor", tagSha, "origin/main"], root);
    } catch (error) {
      throw new Error(`core-v${version} names ${tagSha}, which is not on main`, { cause: error });
    }
  }
  const found = coreVersion(git(["show", `${sha}:${CARGO}`], root));
  if (found !== version) {
    const where = tagSha ? `core-v${version} names ${sha}, where` : "On main,";
    throw new Error(`${where} ${CARGO} says ${found}, not ${version}`);
  }
  return sha;
}

/**
 * The tag's commit on the remote, peeled, or null when there is no tag.
 * @param {string} tag
 * @param {string} root
 */
function remoteTag(tag, root) {
  const lines = git(["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const peeled = lines.find(([, ref]) => ref?.endsWith("^{}")) ?? lines[0];
  return peeled?.[0] ?? null;
}

/**
 * Waits until core.yml has published the release, and stops when it cannot.
 * @param {{ tag: string, github: GitHub, pollMs: number, timeoutMs: number, log: (line: string) => void }} options
 */
async function awaitRelease({ tag, github, pollMs, timeoutMs, log }) {
  const deadline = Date.now() + timeoutMs;
  let said = "";
  for (;;) {
    const published = github.release(tag);
    if (published) return published;
    const run = github.runs(tag)[0];
    if (run?.status === "completed") {
      // A successful run publishes before it ends, so the check above already saw it.
      throw new Error(
        `core.yml ended ${run.conclusion} with no release: ${run.html_url}. ` +
          "Re-run it, or fix it, then run this command again",
      );
    }
    const state = run ? `core.yml ${run.status}: ${run.html_url}` : "waiting for core.yml to start";
    if (state !== said) log(state);
    said = state;
    if (Date.now() >= deadline) {
      throw new Error(`no release for ${tag} in time; run this command again to keep waiting`);
    }
    await sleep(pollMs);
  }
}

/**
 * @param {{ version: string, app?: string, root?: string, github: GitHub, pollMs?: number, timeoutMs?: number, log?: (line: string) => void }} options
 * @returns {Promise<{ branch: string, app: string, sha: string }>}
 */
export async function release({
  version,
  app,
  root = ROOT,
  github,
  pollMs = POLL_MS,
  timeoutMs = TIMEOUT_MS,
  log = console.log,
}) {
  for (const value of [version, app ?? "0.0.0"]) {
    if (!SEMVER.test(value)) throw new Error(`${value} is not X.Y.Z`);
  }
  if (git(["status", "--porcelain"], root).trim()) {
    throw new Error("the working tree is not clean; the last step commits here");
  }
  git(["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], root);

  const tag = `core-v${version}`;
  const tagSha = remoteTag(tag, root);
  const sha = releaseCommit({ version, root, tagSha });
  if (tagSha) {
    log(`${tag} is already on ${sha}`);
  } else {
    git(["push", "-q", "origin", `${sha}:refs/tags/${tag}`], root);
    log(`${tag} pushed on ${sha}`);
  }

  const { assets } = await awaitRelease({ tag, github, pollMs, timeoutMs, log });

  const mainFile = (/** @type {string} */ path) => git(["show", `origin/main:${path}`], root);
  const current = /^\s*versionName = "([^"]+)"$/m.exec(mainFile(GRADLE))?.[1];
  if (!current) throw new Error(`${GRADLE}: no versionName on main`);
  const appVersion = app ?? nextPatch(current);

  const branch = `feat/apps-core-${version}`;
  const exists = git(["branch", "--list", branch], root).trim() !== "";
  git(exists ? ["switch", "-q", branch] : ["switch", "-q", "-c", branch, "origin/main"], root);

  const write = (/** @type {string} */ path, /** @type {(text: string) => string} */ change) => {
    const file = join(root, path);
    writeFileSync(file, change(readFileSync(file, "utf8")));
  };
  write(LOCK, (text) => `${JSON.stringify(lockFor(JSON.parse(text), version, assets), null, 2)}\n`);
  write(GRADLE, (text) => setGradleVersion(text, appVersion));
  write(XCODEGEN, (text) => setXcodegenVersion(text, appVersion));

  git(["add", "--", LOCK, GRADLE, XCODEGEN], root);
  if (git(["diff", "--cached", "--name-only"], root).trim()) {
    git(["commit", "-q", "-m", `feat(apps): version ${appVersion} on core ${version}`], root);
    log(`${branch}: version ${appVersion} on core ${version}, committed`);
  } else {
    log(`${branch} already holds version ${appVersion} on core ${version}`);
  }
  return { branch, app: appVersion, sha };
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function ghApi(args) {
  return JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: "pipe" }));
}

/** @type {GitHub} */
const liveGitHub = {
  release(tag) {
    try {
      return ghApi([`repos/${REPO}/releases/tags/${tag}`]);
    } catch (error) {
      const { stderr } = /** @type {{ stderr?: string }} */ (error);
      if (stderr?.includes("HTTP 404")) return null;
      throw error;
    }
  },
  runs(tag) {
    return ghApi([`repos/${REPO}/actions/workflows/core.yml/runs?event=push&branch=${tag}`])
      .workflow_runs;
  },
};

/** @param {string[]} argv */
async function main(argv) {
  const [version, flag, app] = argv;
  if (!version || (flag && (flag !== "--app" || !app))) {
    throw new Error("usage: node tooling/core-release.mjs <version> [--app <X.Y.Z>]");
  }
  const done = await release({ version, app, github: liveGitHub });
  console.log(`Ready on ${done.branch}: add the apps' changes, then open the PR.`);
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((/** @type {Error} */ error) => {
    console.error(`core-release: ${error.message}`);
    process.exitCode = 1;
  });
}
