// The D1 database of cloudflare.config.ts, for the commands that take its id:
// `cf d1 migrations apply`, `cf d1 query` (scripts/invite-operator.ts). cf
// names a database by id, and the config is the one place it is written.
//
//   node scripts/d1.ts migrate                         # production (migrate:remote)
//   node scripts/d1.ts migrate --local --persist-to .wrangler/state  # cf dev's D1
//
// Runs under plain `node`, like scripts/openapi.ts.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workerConfig } from "./worker-config.ts";

/** The id of the one D1 database the Worker binds. */
export async function databaseId(): Promise<string> {
  const { env } = await workerConfig();
  const ids = Object.values(env).flatMap((b) => (b.type === "d1" && b.id ? [b.id] : []));
  if (ids.length !== 1)
    throw new Error(`cloudflare.config.ts binds ${ids.length} D1 databases with an id, expected 1`);
  return ids[0] as string;
}

/**
 * The command that runs the pinned cf: node on its bin, so that a signal to
 * the child reaches cf itself and not a `pnpm exec` in between (see migrate).
 */
function cf(): [string, string] {
  const manifest = fileURLToPath(import.meta.resolve("cf/package.json"));
  const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as { bin: { cf: string } };
  return [process.execPath, join(dirname(manifest), bin.cf)];
}

/** Runs `cf d1 <args>` against the database, non-interactively. */
export async function cfD1(
  command: string[],
  args: string[],
  stdout: "inherit" | "ignore" = "inherit",
) {
  const [node, bin] = cf();
  const run = spawnSync(node, [bin, "d1", ...command, await databaseId(), ...args], {
    stdio: ["ignore", stdout, "inherit"],
  });
  return run.status ?? 1;
}

/**
 * Runs `cf d1 migrations apply` and returns once every migration is applied.
 *
 * cf (1.0.0-beta.13) prints the result as a JSON array, one entry per
 * migration, but with `--local` it does not always exit afterwards, and in CI
 * it never does: the Miniflare it runs for the local database keeps watching
 * the dev registry. So the result is read from stdout, and once it is complete
 * cf is ended. Miniflare registers itself in that registry and an entry left
 * behind breaks the next local command against the same state ("Network
 * connection lost"), so each run gets a registry of its own, and a temporary
 * directory for what cf leaves there, both removed after it.
 * An exit before the result keeps its own status.
 */
export async function migrate(args: string[]): Promise<number> {
  const scratch = mkdtempSync(join(tmpdir(), "spjall-d1-"));
  const [node, bin] = cf();
  const child = spawn(node, [bin, "d1", "migrations", "apply", await databaseId(), ...args], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CLOUDFLARE_REGISTRY_PATH: join(scratch, "registry"), TMPDIR: scratch },
  });
  let out = "";
  let result: number | undefined;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    process.stdout.write(chunk);
    out += chunk;
    const migrations = result === undefined ? parseResult(out) : undefined;
    if (migrations === undefined) return;
    result = migrations.every((m) => m.status === "\u2705") ? 0 : 1;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 15_000).unref();
  });
  const code = await new Promise<number>((resolve) => {
    child.on("exit", (status) => resolve(result ?? status ?? 1));
  });
  rmSync(scratch, { recursive: true, force: true });
  return code;
}

/** The migrations array once stdout holds all of it, else undefined. */
function parseResult(out: string): { name: string; status: string }[] | undefined {
  const start = out.indexOf("[");
  if (start === -1 || !out.trimEnd().endsWith("]")) return undefined;
  try {
    const value: unknown = JSON.parse(out.slice(start));
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb !== "migrate") {
    console.error("Usage: node scripts/d1.ts migrate [--local --persist-to DIR]");
    process.exit(2);
  }
  process.exit(await migrate(["--dir", "migrations", ...rest]));
}
