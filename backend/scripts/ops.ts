// The maintainer's way back and the jobs (decision 0068, docs/operations.md).
//
//   node scripts/ops.ts way-back                     # D1 bookmark + serving version, as markdown
//   node scripts/ops.ts bookmark [--at ISO]          # a D1 Time Travel bookmark
//   node scripts/ops.ts restore-d1 --bookmark B --yes  # D1 back to B: overwrites everything since
//   node scripts/ops.ts rollback --version V         # serve version V (code only, D1 untouched)
//   node scripts/ops.ts jobs                         # counts, failed and stuck jobs
//   node scripts/ops.ts jobs retry --failed | ID...  # failed jobs pending again
//   node scripts/ops.ts jobs drain                   # run due jobs until none is
//   node scripts/ops.ts restore-space COMMUNITY --at ISO | --bookmark B
//
// `--database ID` and `--worker NAME` stand in for cloudflare.config.ts, and
// `--url BASE` for the API host (the rehearsal). The /ops commands read the
// token from OPS_TOKEN in the environment, never from an argument.
//
// Runs under plain `node`, like scripts/d1.ts.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cf, databaseId } from "./d1.ts";
import { workerConfig } from "./worker-config.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: "string" },
    worker: { type: "string" },
    url: { type: "string" },
    at: { type: "string" },
    bookmark: { type: "string" },
    version: { type: "string" },
    failed: { type: "boolean" },
    yes: { type: "boolean" },
  },
});

/** Runs the pinned cf with `args` and returns its stdout parsed as JSON. */
function cfJson<T>(args: string[]): T {
  const [node, bin] = cf();
  const run = spawnSync(node, [bin, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`cf ${args.slice(0, 3).join(" ")} exited ${run.status}`);
  const out = run.stdout;
  return JSON.parse(out.slice(out.search(/[[{]/))) as T;
}

const database = async () => values.database ?? (await databaseId());
const worker = async () => values.worker ?? (await workerConfig()).name;

function apiBase(): string {
  if (values.url) return values.url.replace(/\/$/, "");
  const ids = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../identifiers/ids.json"),
      "utf8",
    ),
  ) as { hosts: { api: string } };
  return `https://${ids.hosts.api}`;
}

async function opsCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const token = process.env.OPS_TOKEN;
  if (!token) throw new Error("OPS_TOKEN is not set in the environment");
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function bookmark(at?: string): Promise<string> {
  const args = ["d1", "time-travel", "get-bookmark", await database()];
  return cfJson<{ bookmark: string }>(at ? [...args, "--timestamp", at] : args).bookmark;
}

/** The version serving all traffic now: the first deployment's, at 100%. */
async function servingVersion(): Promise<string> {
  const { deployments } = cfJson<{
    deployments: { versions: { version_id: string; percentage: number }[] }[];
  }>(["workers", "deployments", "list", "--worker", await worker(), "--per-page", "1"]);
  const versions = deployments[0]?.versions ?? [];
  const full = versions.find((v) => v.percentage === 100);
  if (!full) throw new Error(`no version serves 100%: ${JSON.stringify(versions)}`);
  return full.version_id;
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Fails the command with its usage, exit status 2. */
function usage(text: string): number {
  console.error(text);
  return 2;
}

async function wayBack(): Promise<number> {
  const [d1, version] = [await bookmark(), await servingVersion()];
  console.log(`### The way back

Taken before the migrations (docs/operations.md, decision 0068).

| | |
|---|---|
| D1 bookmark | \`${d1}\` |
| Worker version serving before this deploy | \`${version}\` |

\`\`\`sh
node scripts/ops.ts rollback --version ${version}
node scripts/ops.ts restore-d1 --bookmark ${d1} --yes   # last resort
\`\`\``);
  return 0;
}

async function restoreD1(): Promise<number> {
  if (!values.bookmark || !values.yes) {
    return usage(
      "restore-d1 overwrites every write to D1 since the bookmark. Pass --bookmark B --yes.",
    );
  }
  const args = ["d1", "time-travel", "restore", await database(), "--bookmark", values.bookmark];
  print(cfJson<unknown>([...args, "--force"]));
  return 0;
}

async function rollback(): Promise<number> {
  if (!values.version) {
    return usage("rollback needs --version V (the summary of the deploy to undo has it).");
  }
  const versions = JSON.stringify([{ version_id: values.version, percentage: 100 }]);
  print(
    cfJson<unknown>([
      "workers",
      "deployments",
      "create",
      "--worker",
      await worker(),
      "--strategy",
      "percentage",
      "--versions",
      versions,
    ]),
  );
  return 0;
}

async function jobs(sub: string | undefined, ids: string[]): Promise<number> {
  if (sub === undefined) print(await opsCall("GET", "/ops/jobs"));
  else if (sub === "drain") print(await opsCall("POST", "/ops/jobs/drain"));
  else if (sub === "retry" && values.failed && ids.length === 0)
    print(await opsCall("POST", "/ops/jobs/retry", { allFailed: true }));
  else if (sub === "retry" && !values.failed && ids.length > 0)
    print(await opsCall("POST", "/ops/jobs/retry", { jobIds: ids.map(Number) }));
  else return usage("Usage: jobs | jobs drain | jobs retry --failed | jobs retry ID...");
  return 0;
}

async function restoreSpace(communityId: string | undefined): Promise<number> {
  if (!communityId || (values.at === undefined) === (values.bookmark === undefined)) {
    return usage("Usage: restore-space COMMUNITY --at ISO | --bookmark B");
  }
  const target = values.at === undefined ? { bookmark: values.bookmark } : { at: values.at };
  print(await opsCall("POST", "/ops/restore", { kind: "space", communityId, ...target }));
  return 0;
}

async function main(): Promise<number> {
  const [verb, sub, ...rest] = positionals;
  switch (verb) {
    case "way-back":
      return wayBack();
    case "bookmark":
      console.log(await bookmark(values.at));
      return 0;
    case "restore-d1":
      return restoreD1();
    case "rollback":
      return rollback();
    case "jobs":
      return jobs(sub, rest);
    case "restore-space":
      return restoreSpace(sub);
    default:
      return usage(
        "Usage: node scripts/ops.ts way-back | bookmark | restore-d1 | rollback | jobs | restore-space",
      );
  }
}

process.exit(await main());
