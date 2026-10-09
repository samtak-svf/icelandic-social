// Lets the first person in (decision 0019): writes one single-use invite with
// no inviter into D1, and prints its link once. D1 keeps only the hash, so the
// link cannot be shown again; run it again for another.
//
//   pnpm --filter spjall-backend invite:operator --remote   # production, through `cf d1 query`
//   pnpm --filter spjall-backend invite:operator --local    # a running `cf dev --mode interop`
//
// cf has no local `d1 query`, so --local asks the dev Worker (dev/worker.ts)
// to write the invite into its own D1. That Worker is never deployed.
//
// Runs under plain `node`, like scripts/openapi.ts.

import { OPERATOR_INVITE_PATH, operatorInvite } from "./operator-invite.ts";

export { operatorInvite };

/** The origin `cf dev` serves on. */
const DEV_ORIGIN = "http://127.0.0.1:8787";

if (import.meta.main) {
  const where = process.argv.find((a) => a === "--local" || a === "--remote");
  if (!where) {
    console.error("Say where: --local (cf dev --mode interop) or --remote (production).");
    process.exit(2);
  }
  if (where === "--local") {
    const response = await fetch(`${DEV_ORIGIN}${OPERATOR_INVITE_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(`The dev Worker answered ${response.status}; no invite was written.`);
      process.exit(1);
    }
    console.log(await response.text());
  } else {
    const { cfD1 } = await import("./d1.ts");
    const { link, sql } = await operatorInvite();
    const status = await cfD1(["query"], ["--sql", sql], "ignore");
    if (status !== 0) {
      console.error("cf d1 query failed; no invite was written.");
      process.exit(status);
    }
    console.log(link);
  }
}
