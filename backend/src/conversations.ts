import { base64url, fromBase64 } from "./bytes.ts";
import type { SendInput } from "./do/conversation.ts";
import { type Framing, FramingError, type Leaf, readFraming } from "./mls/framing.ts";

// What the Worker checks of a send before the `Conversation` DO sees it
// (decisions 0017, 0020, 0021): only the unencrypted MLS framing, never the
// ciphertext. A commit's roster claim is in its authenticated_data, signed
// by the member that made it, so what the server applies is what every
// other member can check against the commit. A commit also carries the
// GroupInfo of the epoch it starts, which a device outside the group joins
// from by an external commit.

type Body = {
  clientMsgId: string;
  ciphertext: string;
  welcome?: { message: string };
  groupInfo?: string;
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

/**
 * A send the DO can store, and for an external commit the leaf its sending
 * device must own, which only D1 can tell.
 */
type Checked = { ok: SendInput; joiner?: Leaf } | { error: "invalid_request" | "group_mismatch" };

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

type Framed = { message: Framing; bytes: Uint8Array };
type Parts = { main: Framed; welcome?: Framed; groupInfo?: Framed };

/** The send's MLS messages with their framing, or null if any is not the kind it must be. */
function readParts(body: Body): Parts | null {
  const read = (text: string, ...kinds: Framing["wireFormat"][]): Framed | null => {
    const bytes = fromBase64(text);
    const message = readFraming(bytes);
    return kinds.includes(message.wireFormat) ? { message, bytes } : null;
  };
  try {
    const main = read(body.ciphertext, "public", "private");
    const welcome = body.welcome && read(body.welcome.message, "welcome");
    const groupInfo = body.groupInfo === undefined ? undefined : read(body.groupInfo, "group_info");
    if (!main || welcome === null || groupInfo === null) return null;
    return { main, welcome, groupInfo };
  } catch (error) {
    if (error instanceof FramingError) return null;
    throw error;
  }
}

/** Whether a GroupInfo is of this commit's group at the epoch after the commit's. */
function startsNextEpoch(
  groupInfo: Framed | undefined,
  commit: { groupId: Uint8Array; epoch: number },
): groupInfo is Framed {
  const info = groupInfo?.message;
  return (
    info?.wireFormat === "group_info" &&
    equal(info.groupId, commit.groupId) &&
    info.epoch === commit.epoch + 1
  );
}

type Message = Extract<Framing, { wireFormat: "public" | "private" }>;

/** A commit's part of `checkSend`: its claim, its Welcome, its GroupInfo, its joiner. */
function checkCommit(input: SendInput, framing: Message, { welcome, groupInfo }: Parts): Checked {
  const claim = readClaim(framing.authenticatedData);
  const { joiner } = framing;
  if (
    !claim?.roster.includes(input.account) ||
    claim.welcome.length > 0 !== (welcome !== undefined) ||
    !startsNextEpoch(groupInfo, framing) ||
    (joiner && welcome)
  ) {
    return { error: "invalid_request" };
  }
  return {
    ok: {
      ...input,
      commitEpoch: framing.epoch,
      roster: claim.roster,
      groupInfo: groupInfo.bytes,
      ...(joiner && { external: true }),
      ...(welcome && { welcome: { to: claim.welcome, message: welcome.bytes } }),
    },
    ...(joiner && { joiner }),
  };
}

/**
 * A send the DO can store: a PublicMessage or PrivateMessage of this
 * conversation's group. A commit carries a claim that keeps its sender in
 * the roster, a Welcome exactly when the claim names whom it is for, and
 * the GroupInfo of this group at the epoch after the commit's. An external
 * commit brings no Welcome; the DO checks it leaves the roster as it is.
 */
export function checkSend(account: string, conversationId: string, body: Body): Checked {
  const parts = readParts(body);
  if (!parts) return { error: "invalid_request" };
  // readParts let only a PublicMessage or PrivateMessage through as the main part.
  const framing = parts.main.message as Message;
  if (base64url(framing.groupId) !== conversationId) return { error: "group_mismatch" };
  const input = { account, clientMsgId: body.clientMsgId, ciphertext: parts.main.bytes };
  if (framing.contentType === "commit") return checkCommit(input, framing, parts);
  return parts.welcome || parts.groupInfo ? { error: "invalid_request" } : { ok: input };
}
