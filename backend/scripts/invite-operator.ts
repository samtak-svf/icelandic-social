// Lets the first person in (decision 0019): writes one single-use invite with
// no inviter into D1 through `wrangler d1 execute`, and prints its link once.
// D1 keeps only the hash, so the link cannot be shown again; run it again for
// another.
//
//   pnpm --filter spjall-backend invite:operator --local    # wrangler dev's D1
//   pnpm --filter spjall-backend invite:operator --remote   # production
//
// `--persist-to <dir>` is passed on with `--local`, for a `wrangler dev`
// started with the same flag (interop.yml).
//
// Runs under plain `node`, like scripts/openapi.ts.

import ids from "../../identifiers/ids.json" with { type: "json" };
import { randomToken, tokenHash } from "../src/accounts.ts";
import { inviteLink } from "../src/invites.ts";

/** A new operator invite: its token, its link, and the SQL that stores its hash. */
export async function operatorInvite(now = Date.now()) {
  const token = randomToken("");
  const hash = await tokenHash(token);
  // Both values are made here, hex and an integer, so nothing outside is
  // spliced into the statement.
  const sql = `INSERT INTO invites (token_hash, inviter_account_id, single_use, created_at) VALUES ('${hash}', NULL, 1, ${Math.trunc(now)});`;
  return { token, link: inviteLink(token), sql };
}

if (import.meta.main) {
  const where = process.argv.find((a) => a === "--local" || a === "--remote");
  if (!where) {
    console.error("Say where: --local (wrangler dev's D1) or --remote (production).");
    process.exit(2);
  }
  const { spawnSync } = await import("node:child_process");
  const at = process.argv.indexOf("--persist-to");
  const persist = at > 0 ? ["--persist-to", process.argv[at + 1] ?? ""] : [];
  if (persist.length > 0 && (where !== "--local" || !persist[1])) {
    console.error("--persist-to takes a directory, and only with --local.");
    process.exit(2);
  }
  const { link, sql } = await operatorInvite();
  const run = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", ids.cloudflare.d1, where, ...persist, "--command", sql],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (run.status !== 0) {
    console.error("wrangler d1 execute failed; no invite was written.");
    process.exit(run.status ?? 1);
  }
  console.log(link);
}
