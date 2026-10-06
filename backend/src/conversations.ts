import { base64url, fromBase64 } from "./bytes.ts";
import type { SendInput } from "./do/conversation.ts";
import { FramingError, readFraming } from "./mls/framing.ts";

// What the Worker checks of a send before the `Conversation` DO sees it
// (decisions 0017, 0020): only the unencrypted MLS framing, never the
// ciphertext. A commit's roster claim is in its authenticated_data, signed
// by the member that made it, so what the server applies is what every
// other member can check against the commit.

type Body = {
  clientMsgId: string;
  ciphertext: string;
  welcome?: { message: string };
};

/** An account id, as `OpaqueId` and the core's `Device` take it. */
const ACCOUNT = /^[A-Za-z0-9_-]{1,128}$/;

/** The most accounts a claim may name. */
const MAX_ROSTER = 1000;

/** A commit's claim (0020): every account after it, and who its Welcome is for. */
type Claim = { roster: string[]; welcome: string[] };

function accounts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ROSTER) return null;
  if (!value.every((a) => typeof a === "string" && ACCOUNT.test(a))) return null;
  return [...new Set(value as string[])];
}

/** The JSON the core writes, or null for anything else. */
export function readClaim(authenticatedData: Uint8Array): Claim | null {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(authenticatedData),
    );
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const roster = accounts((value as Record<string, unknown>).roster);
  const welcome = accounts((value as Record<string, unknown>).welcome);
  return roster && welcome ? { roster, welcome } : null;
}

type Checked = { ok: SendInput } | { error: "invalid_request" | "group_mismatch" };

/**
 * A send the DO can store: a PublicMessage or PrivateMessage of this
 * conversation's group. A commit carries a claim that keeps its sender in
 * the roster, and a Welcome exactly when the claim names whom it is for.
 */
export function checkSend(account: string, conversationId: string, body: Body): Checked {
  let framing;
  let welcome: Uint8Array | undefined;
  try {
    framing = readFraming(fromBase64(body.ciphertext));
    if (body.welcome) {
      welcome = fromBase64(body.welcome.message);
      if (readFraming(welcome).wireFormat !== "welcome") return { error: "invalid_request" };
    }
  } catch (error) {
    if (error instanceof FramingError) return { error: "invalid_request" };
    throw error;
  }
  if (framing.wireFormat !== "public" && framing.wireFormat !== "private") {
    return { error: "invalid_request" };
  }
  if (base64url(framing.groupId) !== conversationId) return { error: "group_mismatch" };
  const input = { account, clientMsgId: body.clientMsgId, ciphertext: fromBase64(body.ciphertext) };
  if (framing.contentType !== "commit") {
    return welcome ? { error: "invalid_request" } : { ok: input };
  }
  const claim = readClaim(framing.authenticatedData);
  if (!claim?.roster.includes(account)) return { error: "invalid_request" };
  if (claim.welcome.length > 0 !== (welcome !== undefined)) return { error: "invalid_request" };
  return {
    ok: {
      ...input,
      commitEpoch: framing.epoch,
      roster: claim.roster,
      ...(welcome && { welcome: { to: claim.welcome, message: welcome } }),
    },
  };
}
