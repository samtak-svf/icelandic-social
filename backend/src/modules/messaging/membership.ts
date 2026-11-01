import type { Context } from "hono";
import { conversation } from "../../env/index.ts";
import { fail } from "../../shared/errors.ts";
import type { AppEnv } from "../../http.ts";

// Who may act on a conversation, asked of the Conversation DO: it holds the
// membership, so the Worker asks it rather than a copy in D1 (decisions 0015,
// 0023). Every route that reads or writes something of a conversation asks
// here first, so a non-member learns nothing about it and a missing one is a
// 404 rather than a 403.

/**
 * The answer that refuses a caller who is not a member of `conversationId`,
 * or null when it is one. A conversation that is not there is a 404, so its
 * existence is not told to whoever names it; one the caller is not in is a 403.
 */
export async function requireMember(c: Context<AppEnv>, conversationId: string) {
  const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
  if (!("error" in member)) return null;
  return member.error === "not_found" ? fail(c, 404, "not_found") : fail(c, 403, "not_a_member");
}
