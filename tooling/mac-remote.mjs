// @ts-check
// Run the iOS build on a Mac of Samtak's own, from a Linux machine, without a
// push to GitHub. ios.yml takes ten minutes on a fresh hosted runner; a Mac
// that keeps its DerivedData and core between runs needs only what changed.
//
// What reaches the Mac is the working tree as git sees it: tracked files with
// their uncommitted edits, plus new files that are not ignored. It travels as
// a commit made with a throwaway index, so the caller's index is untouched,
// and the Mac checks it out and cleans it, so a file deleted here is deleted
// there. Ignored paths never leave this machine: private/ (decision 0008),
// .dev.vars, build output. The Mac keeps its own ignored output (DerivedData,
// the fetched core, the generated project) between runs.
//
//   node tooling/mac-remote.mjs [--host <ssh host>] [--dir <dir>] [ios | -- <command…>]
//     ios (the default) runs ios/scripts/test.sh --prepare there
//
// The host is an ssh alias (~/.ssh/config), by default SPJALL_MAC_HOST or
// samtak-mac; the Mac is set up once with tooling/mac-bootstrap.sh.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GIT_ENV, ROOT } from "./lib/repo.mjs";

const TASKS = { ios: "ios/scripts/test.sh --prepare" };

/**
 * A commit of the working tree as `git add -A` would stage it, parented on
 * HEAD, made without touching the repository's own index.
 * @param {string} [root]
 * @returns {string} the commit id
 */
export function snapshot(root = ROOT) {
  const dir = mkdtempSync(join(tmpdir(), "spjall-snapshot-"));
  try {
    const index = join(dir, "index");
    const real = resolve(root, gitIn(root, ["rev-parse", "--git-path", "index"]).trim());
    // Starting from the real index lets git reuse its stat cache.
    if (existsSync(real)) copyFileSync(real, index);
    const env = { ...GIT_ENV, GIT_INDEX_FILE: index };
    gitIn(root, ["add", "-A"], env);
    const tree = gitIn(root, ["write-tree"], env).trim();
    // A fixed identity: the commit never leaves the two machines, and a
    // checkout with no user.name configured can still make one.
    const who = { GIT_AUTHOR_NAME: "mac-remote", GIT_AUTHOR_EMAIL: "mac-remote@localhost" };
    const ident = {
      ...who,
      GIT_COMMITTER_NAME: who.GIT_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: who.GIT_AUTHOR_EMAIL,
    };
    return gitIn(root, ["commit-tree", tree, "-p", "HEAD", "-m", "mac-remote snapshot"], {
      ...GIT_ENV,
      ...ident,
    }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The shell line the Mac runs: check the snapshot out exactly, then the task.
 * @param {string} dir
 * @param {string} commit
 * @param {string} command
 */
export function remoteScript(dir, commit, command) {
  return `cd ${quote(dir)} && git checkout -qf --detach ${commit} && git clean -qfd && ${command}`;
}

/**
 * @param {string[]} argv
 * @returns {{ host: string, dir: string, command: string }}
 */
export function parseArgs(argv) {
  let host = process.env.SPJALL_MAC_HOST || "samtak-mac";
  let dir = "spjall";
  let command = TASKS.ios;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host" || arg === "--dir") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      if (arg === "--host") host = value;
      else dir = value;
    } else if (arg === "--") {
      const rest = argv.slice(i + 1);
      if (!rest.length) throw new Error("-- needs a command");
      command = rest.join(" ");
      break;
    } else if (arg !== undefined && Object.hasOwn(TASKS, arg)) {
      command = TASKS[/** @type {keyof typeof TASKS} */ (arg)];
    } else {
      throw new Error(`unknown argument ${arg}; tasks: ${Object.keys(TASKS).join(", ")}`);
    }
  }
  return { host, dir, command };
}

/** @param {string} text */
function quote(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function gitIn(root, args, env = GIT_ENV) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env });
}

if (import.meta.main) {
  const { host, dir, command } = parseArgs(process.argv.slice(2));
  const commit = snapshot();
  const inherit = { stdio: /** @type {const} */ ("inherit"), env: GIT_ENV };
  // `git init` on an existing repository only re-initialises it.
  execFileSync("ssh", [host, `git init -q ${quote(dir)}`], inherit);
  execFileSync(
    "git",
    ["push", "-q", "--force", `${host}:${dir}`, `${commit}:refs/heads/snapshot`],
    {
      ...inherit,
      cwd: ROOT,
    },
  );
  try {
    execFileSync("ssh", ["-t", host, remoteScript(dir, commit, command)], inherit);
  } catch (error) {
    process.exitCode = /** @type {{ status?: number }} */ (error).status ?? 1;
  }
}
