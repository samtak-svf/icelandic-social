// Runs the one-off operator wipe (decision 0058): POSTs /operator/wipe until
// no account and no leftover is there, printing the counts of each call. The
// token is read from the environment and never printed.
//
//   SPJALL_API_BASE_URL=https://spjall.samtak.is OPERATOR_WIPE_TOKEN=… \
//     pnpm --filter spjall-backend wipe:operator
//
// backend/README.md has the whole run, from the vault to deleting the secret.
// Runs under plain `node`, like scripts/openapi.ts.

/** What one call answers (src/wipe.ts). */
type WipeResult = { deleted: number; remaining: number; leftovers: number };

/** A call that deletes nothing and clears nothing this many times in a row is a stall. */
const STALLS = 3;

/**
 * Calls the route until both counts are zero. `post` makes one call, so a
 * test can stand in for the network.
 */
export async function runWipe(
  post: () => Promise<WipeResult>,
  report: (line: string) => void = console.log,
): Promise<number> {
  let total = 0;
  let stalled = 0;
  let before = Infinity;
  for (;;) {
    const result = await post();
    total += result.deleted;
    report(
      `deleted ${result.deleted}, ${result.remaining} accounts and ${result.leftovers} leftovers remain`,
    );
    if (result.remaining === 0 && result.leftovers === 0) return total;
    const left = result.remaining + result.leftovers;
    stalled = result.deleted === 0 && left >= before ? stalled + 1 : 0;
    if (stalled >= STALLS) throw new Error(`no progress in ${STALLS} calls; stopped`);
    before = left;
  }
}

if (import.meta.main) {
  const base = process.env.SPJALL_API_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.OPERATOR_WIPE_TOKEN;
  if (!base || !token) {
    console.error("Set SPJALL_API_BASE_URL and OPERATOR_WIPE_TOKEN.");
    process.exit(2);
  }
  const post = async (): Promise<WipeResult> => {
    const response = await fetch(`${base}/operator/wipe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      // A 404 is the route off or the token wrong; the two answer alike.
      throw new Error(`the Worker answered ${response.status}`);
    }
    return (await response.json()) as WipeResult;
  };
  try {
    const total = await runWipe(post);
    console.log(`done: ${total} accounts deleted, nothing left`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
