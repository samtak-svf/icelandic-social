// The maintainer's machine's half of the testers' assistant (decision 0076,
// docs/operations.md): takes the iPhone requests the assistant queued, adds
// each address to the TestFlight group, and tells the Worker how it went, so
// the assistant can tell the tester. No model runs here.
//
//   node scripts/testers.ts            # once; the systemd timer runs it every 5 minutes
//   node scripts/testers.ts --dry-run  # list what waits, add nobody
//
// OPS_TOKEN and the App Store Connect key come from the environment when set,
// otherwise from the maintainer's vault (project samtak-secrets). `--url BASE`
// stands in for the API host. Runs under plain `node`, like scripts/ops.ts.

import { execFileSync } from "node:child_process";
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { url: { type: "string" }, "dry-run": { type: "boolean" } },
});

const ASC = "https://api.appstoreconnect.apple.com";
const GROUP = "Prufuflug";

/** A secret from the environment, or from the vault under `vaultName`. */
function secret(envName: string, vaultName: string): string {
  const set = process.env[envName];
  if (set) return set;
  return execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${vaultName}`,
      "--project=samtak-secrets",
      "--account=gudrodur@gmail.com",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

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

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** An App Store Connect token, good for 20 minutes (ES256, the key's own id). */
function ascToken(): string {
  const keyId = secret("ASC_API_KEY_ID", "samtak-apple-team-asc-api-key-id");
  const issuer = secret("ASC_API_ISSUER_ID", "samtak-apple-team-asc-api-issuer-id");
  const p8 = secret("ASC_API_KEY_P8", "samtak-apple-team-asc-api-key-p8");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ iss: issuer, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" }),
  );
  const signature = createSign("SHA256")
    .update(`${head}.${body}`)
    .sign({ key: createPrivateKey(p8), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(signature)}`;
}

type Pending = { requestId: string; platform: string; address: string };

async function ops(method: string, path: string, token: string, body?: unknown) {
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
  return JSON.parse(text) as unknown;
}

async function asc(method: string, path: string, token: string, body?: unknown) {
  return fetch(`${ASC}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Adds `address` to the group: done when it is added, or is already a tester
 * (409); otherwise the reason, which the Worker keeps.
 */
async function addTester(address: string, groupId: string, token: string): Promise<string | null> {
  const response = await asc("POST", "/v1/betaTesters", token, {
    data: {
      type: "betaTesters",
      attributes: { email: address },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } },
    },
  });
  if (response.status === 201 || response.status === 409) return null;
  const { errors } = (await response.json().catch(() => ({}))) as {
    errors?: { code?: string; detail?: string }[];
  };
  return `${response.status} ${errors?.[0]?.code ?? ""}`.trim();
}

const opsToken = secret("OPS_TOKEN", "samtak-spjall-ops-token");
const { requests } = (await ops("GET", "/ops/testers/pending?platform=ios", opsToken)) as {
  requests: Pending[];
};
if (requests.length === 0 || values["dry-run"]) {
  console.log(`${requests.length} waiting`);
  process.exit(0);
}

const token = ascToken();
const groups = await asc("GET", `/v1/betaGroups?filter[name]=${GROUP}&limit=1`, token);
if (!groups.ok) throw new Error(`betaGroups: ${groups.status}`);
const [group] = ((await groups.json()) as { data: { id: string }[] }).data;
if (!group) throw new Error(`no beta group named ${GROUP}`);

for (const request of requests) {
  const error = await addTester(request.address, group.id, token);
  // A token the store refuses fails every request alike; leave them waiting.
  if (error?.startsWith("401") || error?.startsWith("403"))
    throw new Error(`App Store Connect: ${error}`);
  await ops("POST", `/ops/testers/${request.requestId}`, opsToken, {
    outcome: error ? "failed" : "done",
    ...(error ? { error } : {}),
  });
  console.log(`${request.requestId} ${error ? `failed ${error}` : "done"}`);
}
