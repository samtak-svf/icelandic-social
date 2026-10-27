// @ts-check
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";
import { tempDir } from "./helpers.mjs";

const HOOK = join(ROOT, "tooling", "mac-runner-hook.sh");

/** @type {number[]} */
let spawned = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A killed child stays a zombie until its parent reaps it; that is not alive.
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout;
  return state.trim() !== "" && !state.trim().startsWith("Z");
}

/**
 * A background process whose argv0 is `name`, optionally ignoring SIGTERM.
 * @param {string} name
 * @param {boolean} [ignoreTerm]
 * @returns {Promise<number>}
 */
async function start(name, ignoreTerm = false) {
  const trap = ignoreTerm ? "trap '' TERM; " : "";
  const child = spawn("bash", ["-c", `${trap}exec -a "$0" sleep 300`, name], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  const pid = /** @type {number} */ (child.pid);
  spawned.push(pid);
  // Wait for the exec to rename the process: before it, argv0 is `bash`.
  for (let i = 0; i < 100; i++) {
    const cmd = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout;
    if (cmd.includes(name)) return pid;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`process ${name} did not start`);
}

/** @param {Record<string, string | undefined>} env */
function runHook(env) {
  return spawnSync("bash", [HOOK], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SPJALL_REAP_GRACE_SECONDS: "1", ...env },
  });
}

describe("mac-runner-hook.sh", () => {
  it("reaps what runs under this runner's _work, SIGKILLing what ignores SIGTERM, and nothing else", async () => {
    const tmp = tempDir("spjall-hook-");
    mkdirSync(join(tmp, "r1", "_work", "repo"), { recursive: true });
    const mine = await start(join(tmp, "r1", "_work", "x", "workerd"));
    const stubborn = await start(join(tmp, "r1", "_work", "y", "node"), true);
    const otherRunner = await start(join(tmp, "r2", "_work", "x", "workerd"));
    const outside = await start(join(tmp, "r1", "bin", "Runner.Listener"));

    const result = runHook({ RUNNER_WORKSPACE: join(tmp, "r1", "_work", "repo") });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mac-runner-hook: reaped 2 (1 killed)");
    expect(result.stdout).not.toContain(tmp);
    expect(alive(mine)).toBe(false);
    expect(alive(stubborn)).toBe(false);
    expect(alive(otherRunner)).toBe(true);
    expect(alive(outside)).toBe(true);
  });

  it("refuses, exit 0, when RUNNER_WORKSPACE is unset", async () => {
    const tmp = tempDir("spjall-hook-");
    const pid = await start(join(tmp, "r1", "_work", "x", "workerd"));
    const result = runHook({});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RUNNER_WORKSPACE");
    expect(alive(pid)).toBe(true);
  });

  it("refuses, exit 0, when the work dir is not named _work", async () => {
    const tmp = tempDir("spjall-hook-");
    const pid = await start(join(tmp, "r1", "work", "x", "workerd"));
    const result = runHook({ RUNNER_WORKSPACE: join(tmp, "r1", "work", "repo") });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_work");
    expect(alive(pid)).toBe(true);
  });
});
