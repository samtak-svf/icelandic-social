// @ts-check
// Copies the Worker's secrets from the vault (decision 0026) into the deployed
// Worker spjall-api, without writing a value to disk or to the terminal.
//
//   node tooling/worker-secrets.mjs --dry-run
//   node tooling/worker-secrets.mjs [--only=NAME,NAME] [--gcloud-account=ADDRESS]
//
// Each value is read with `gcloud secrets versions access` and the set goes as
// a JSON Merge Patch on stdin to `cf workers secrets bulk` (one new version
// with every change); `cf workers secrets list` then has to show every name
// sent. Neither the values nor the API's answer are printed. Run it after the Worker's first deploy (a secret needs
// a Worker to belong to) and again whenever a vault value changes.
//
// SECRETS below has one row per name in the `Secrets` type of
// backend/src/env/index.ts, which a test holds, so a new secret cannot be
// added to the Worker and forgotten here.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readJson, ROOT } from "./lib/repo.mjs";

/**
 * `now`: set on every run. `later`: its vault entry does not exist yet (the
 * reason says what it waits for). `never`: the Worker reads it but this
 * deployment does not use it.
 *
 * @typedef {{ name: string, vault: string | null, when: "now" | "later" | "never", reason?: string }} Secret
 */

/** @type {Secret[]} the vault name is without the prefix from ids.json */
export const SECRETS = [
  // The HMAC key of kennitölur (decisions 0014, 0019). Every account is looked
  // up by HMAC(kennitala), so a rotation keeps the old key as the previous one
  // while rows move at sign-in (backend/README.md).
  { name: "KENNITALA_HMAC_KEY", vault: "kennitala-hmac-key", when: "now" },
  {
    name: "KENNITALA_HMAC_KEY_PREVIOUS",
    vault: "kennitala-hmac-key-previous",
    when: "later",
    reason: "set only while the kennitala HMAC key is rotated",
  },
  {
    name: "KENNI_CLIENT_SECRET",
    vault: null,
    when: "never",
    reason: "the Kenni client is public (decision 0019)",
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    vault: "google-client-secret",
    when: "later",
    reason: "set once the Google web client exists (decision 0033)",
  },
  { name: "FCM_SERVICE_ACCOUNT", vault: "fcm-service-account", when: "now" },
  {
    name: "APNS_KEY_P8",
    vault: "apns-key",
    when: "now",
  },
  {
    name: "APNS_KEY_ID",
    vault: "apns-key-id",
    when: "now",
  },
];

/**
 * The rows to send: every `now` row, or exactly the named ones. Naming a
 * `never` row or an unknown name is an error, not a skip.
 *
 * @param {Secret[]} secrets
 * @param {string[] | null} only
 * @returns {Secret[]}
 */
export function select(secrets, only) {
  if (!only) return secrets.filter((s) => s.when === "now");
  return only.map((name) => {
    const row = secrets.find((s) => s.name === name);
    if (!row) throw new Error(`${name} is not a Worker secret`);
    if (!row.vault) throw new Error(`${name} has no vault entry: ${row.reason}`);
    return row;
  });
}

/**
 * @param {{ gcpSecretProject: string, gcpSecretPrefix: string }} services
 * @param {Secret} row
 */
export function vaultName(services, row) {
  return `${services.gcpSecretPrefix}${row.vault}`;
}

/**
 * The secrets-bulk body: each name set as text, every other secret left alone.
 *
 * @param {Record<string, string>} values
 */
export function mergePatch(values) {
  return {
    secrets: Object.fromEntries(
      Object.entries(values).map(([name, text]) => [name, { name, type: "secret_text", text }]),
    ),
  };
}

function main() {
  const arg = (/** @type {string} */ flag) =>
    process.argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
  const only = arg("--only")?.split(",") ?? null;
  const account = arg("--gcloud-account");
  const { services } = readJson("identifiers/ids.json");
  const rows = select(SECRETS, only);

  if (process.argv.includes("--dry-run")) {
    for (const row of SECRETS) {
      const sent = rows.includes(row) ? "send" : `skip (${row.reason ?? row.when})`;
      console.log(`${row.name.padEnd(20)} ${row.vault ? vaultName(services, row) : "-"}  ${sent}`);
    }
    return;
  }

  /** @type {Record<string, string>} */
  const values = {};
  for (const row of rows) {
    values[row.name] = execFileSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        `--project=${services.gcpSecretProject}`,
        `--secret=${vaultName(services, row)}`,
        ...(account ? [`--account=${account}`] : []),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  }

  const backend = join(ROOT, "backend");
  const worker = ["--worker", "spjall-api"];
  execFileSync(
    "pnpm",
    ["exec", "cf", "workers", "secrets", "bulk", ...worker, "--file", "/dev/stdin"],
    {
      cwd: backend,
      input: JSON.stringify(mergePatch(values)),
      stdio: ["pipe", "ignore", "inherit"],
    },
  );

  const listed = JSON.parse(
    execFileSync("pnpm", ["exec", "cf", "workers", "secrets", "list", ...worker], {
      cwd: backend,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ).map((/** @type {{ name: string }} */ s) => s.name);
  const missing = Object.keys(values).filter((name) => !listed.includes(name));
  if (missing.length > 0) {
    console.error(`❌ cf workers secrets list does not show ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ ${Object.keys(values).join(", ")} set on the Worker`);
}

if (import.meta.main) main();
