// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, ROOT } from "../lib/repo.mjs";
import { SECRETS, select, vaultName } from "../worker-secrets.mjs";

const { services } = readJson("identifiers/ids.json");

/** The keys of `type Secrets = { … }` in the Worker's env seam. */
function workerSecrets() {
  const source = readFileSync(join(ROOT, "backend/src/env/index.ts"), "utf8");
  const body = source.match(/type Secrets = \{([^}]*)\}/)?.[1];
  if (!body) throw new Error("backend/src/env/index.ts has no `type Secrets`");
  return [...body.matchAll(/^\s*([A-Z0-9_]+)\??:/gm)].map((m) => m[1]);
}

describe("worker-secrets", () => {
  it("has one row per secret the Worker reads", () => {
    expect(SECRETS.map((s) => s.name).sort()).toEqual(workerSecrets().sort());
  });

  it("gives every row it does not send a reason", () => {
    for (const row of SECRETS.filter((s) => s.when !== "now")) expect(row.reason).toBeTruthy();
  });

  it("names vault secrets with the prefix from ids.json", () => {
    const row = SECRETS.find((s) => s.name === "FCM_SERVICE_ACCOUNT");
    expect(row && vaultName(services, row)).toBe("samtak-spjall-fcm-service-account");
  });

  it("sends the `now` rows by default", () => {
    expect(select(SECRETS, null).map((s) => s.name)).toEqual([
      "KENNITALA_HMAC_KEY",
      "FCM_SERVICE_ACCOUNT",
      "APNS_KEY_P8",
      "APNS_KEY_ID",
    ]);
  });

  it("sends a named row, and refuses unknown and unused names", () => {
    expect(select(SECRETS, ["APNS_KEY_ID"]).map((s) => s.name)).toEqual(["APNS_KEY_ID"]);
    expect(() => select(SECRETS, ["NOPE"])).toThrow(/not a Worker secret/);
    expect(() => select(SECRETS, ["KENNI_CLIENT_SECRET"])).toThrow(/public/);
  });
});
