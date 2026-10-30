// @ts-check
// Run the iOS, Android or web e2e checks on a Mac of Samtak's own, from a Linux
// machine, without a push to GitHub. ios.yml takes ten minutes on a fresh
// hosted runner; a Mac that keeps its DerivedData and core between runs needs
// only what changed.
//
// The transport is the maintainer's shared mac-remote script, so every repo
// that uses the Mac obeys one data rule: the Mac is rented, and no secret and
// no personal data may reach it. It ships tracked files with their edits plus
// new files that are not ignored, deletes there what was deleted here, and
// refuses the whole run when a selected path is under private/ (decision 0008),
// .wrangler/ or secrets/, or is a secret-bearing file. Ignored paths never
// leave this machine; the Mac keeps its own ignored output (DerivedData, the
// fetched core, the generated project) between runs. This file only names the
// tasks and this repo's defaults.
//
//   node tooling/mac-remote.mjs [--host <ssh host>] [--dir <dir>] [ios | android | -- <command…>]
//     ios (the default) runs ios/scripts/test.sh --prepare there
//     android runs android/scripts/test.sh, then again with --connected (checks and emulator tests)
//     web runs web/scripts/e2e.sh --prepare (the Worker under cf dev, then Playwright)
//
// web and interop runs get a free Worker port (CI=1 makes backend/scripts/dev-worker.sh
// pick one), so they do not collide with CI or each other; android keeps 8787,
// where the emulator reaches the Worker at 10.0.2.2.
//
// Without --dir the shared script picks the remote directory itself, one per
// checkout (remote/<repo>-<hash of the checkout path>), so two worktrees never
// share a directory or its lock; --dir <dir> is forwarded only when given.
//
// The host is an ssh alias (~/.ssh/config), by default SPJALL_MAC_HOST or
// samtak-mac; the Mac is set up once with tooling/mac-bootstrap.sh. The shared
// script is MAC_REMOTE_SCRIPT, by default ~/agent-config/scripts/mac-remote.mjs.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const TASKS = {
  ios: "ios/scripts/test.sh --prepare",
  android: "android/scripts/test.sh && android/scripts/test.sh --connected",
  web: "CI=1 web/scripts/e2e.sh --prepare",
};

/**
 * @param {string[]} argv
 * @returns {{ host: string, dir?: string, command: string }}
 */
export function parseArgs(argv) {
  let host = process.env.SPJALL_MAC_HOST || "samtak-mac";
  /** @type {string | undefined} */
  let dir;
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

/**
 * The arguments for the shared script: this checkout, the host, the
 * directory only when the user gave one, then the command after `--`.
 * @param {{ host: string, dir?: string, command: string }} options
 * @param {string} [root]
 */
export function sharedArgs({ host, dir, command }, root = ROOT) {
  return ["--repo", root, "--host", host, ...(dir ? ["--dir", dir] : []), "--", command];
}

/** @param {NodeJS.ProcessEnv} [env] */
export function sharedScript(env = process.env) {
  return env.MAC_REMOTE_SCRIPT || join(homedir(), "agent-config/scripts/mac-remote.mjs");
}

if (import.meta.main) {
  const script = sharedScript();
  if (!existsSync(script)) {
    console.error(`mac-remote: the shared script is not at ${script}; set MAC_REMOTE_SCRIPT`);
    process.exit(2);
  }
  const args = sharedArgs(parseArgs(process.argv.slice(2)));
  const run = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}
