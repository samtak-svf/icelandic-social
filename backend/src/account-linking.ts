import { deleteAccount } from "./account-deletion.ts";
import { type Caller, linkIdentity, type Person } from "./identity/index.ts";
import { log } from "./log.ts";

// Linking reaches above the identity module: a join deletes the account it
// leaves, which every module takes part in, as account-deletion.ts does.

/**
 * Links a person to the caller's account, a phone's or a browser's, and with
 * merge joins an older Kenni account (decisions 0035, 0069). A join leaves
 * the calling account empty; it goes as DELETE /v1/me deletes one.
 */
export async function linkOrJoin(
  env: Env,
  caller: Caller,
  person: Person,
  requestId: string,
  merge = true,
) {
  const { accountId } = caller;
  const linked = await linkIdentity(env, caller, person, { merge });
  if ("error" in linked) {
    log("identity.link_refused", {
      accountId,
      code: linked.error,
      provider: person.provider,
      requestId,
    });
    return linked;
  }
  if (linked.ok.merged) await deleteAccount(env, accountId);
  if (linked.ok.merged) log("account.merged_away", { accountId });
  log(linked.ok.merged ? "identity.merged" : "identity.linked", {
    accountId: linked.ok.accountId,
    sessionId: caller.sessionId,
    ...(caller.deviceId ? { deviceId: caller.deviceId } : {}),
    provider: person.provider,
  });
  return linked;
}
