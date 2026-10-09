// The operator's invite (decision 0019), shared by scripts/invite-operator.ts
// and dev/worker.ts. Nothing here touches Node or a binding, so the dev Worker
// can bundle it.

import { randomToken, tokenHash } from "../src/accounts.ts";
import { inviteLink } from "../src/invites.ts";

/** Where `cf dev --mode interop` writes an operator invite into its local D1. */
export const OPERATOR_INVITE_PATH = "/dev/operator-invite";

/** A new operator invite: its token, its link, and the SQL that stores its hash. */
export async function operatorInvite(now = Date.now()) {
  const token = randomToken("");
  const hash = await tokenHash(token);
  // Both values are made here, hex and an integer, so nothing outside is
  // spliced into the statement.
  const sql = `INSERT INTO invites (token_hash, inviter_account_id, single_use, created_at) VALUES ('${hash}', NULL, 1, ${Math.trunc(now)});`;
  return { token, link: inviteLink(token), sql };
}
