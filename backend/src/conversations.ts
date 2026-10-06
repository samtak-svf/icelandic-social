import { base64url, fromBase64 } from "./bytes.ts";
import type { SendInput } from "./do/conversation.ts";
import { FramingError, readFraming } from "./mls/framing.ts";

// What the Worker checks of a send before the `Conversation` DO sees it
// (decision 0017): only the unencrypted MLS framing, never the ciphertext.

type Body = {
  clientMsgId: string;
  ciphertext: string;
  roster?: { add?: string[]; remove?: string[] };
  welcome?: { to: string[]; message: string };
};

type Checked = { ok: SendInput } | { error: "invalid_request" | "group_mismatch" };

/**
 * A send the DO can store: a PublicMessage or PrivateMessage of this
 * conversation's group, with a roster change and a Welcome only on a commit.
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
  const commit = framing.contentType === "commit";
  if (!commit && (body.roster || body.welcome)) return { error: "invalid_request" };
  return {
    ok: {
      account,
      clientMsgId: body.clientMsgId,
      ciphertext: fromBase64(body.ciphertext),
      ...(commit && { commitEpoch: framing.epoch }),
      ...(body.roster && { roster: body.roster }),
      ...(welcome && { welcome: { to: body.welcome!.to, message: welcome } }),
    },
  };
}
