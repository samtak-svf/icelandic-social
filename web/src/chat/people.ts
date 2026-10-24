import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Message } from "../generated/core.d.ts";

/** A conversation's title: its name, else its members' names, else "only you". */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.name !== null && conversation.name !== "") return conversation.name;
  const names = conversation.members
    .map((m) => m.name)
    .filter((n): n is string => n !== null && n !== "");
  return names.length > 0 ? names.join(", ") : strings.conversation_alone_title;
}

/** The last item as a line of text; "" for the kinds that have none. */
export function lastLine(conversation: Conversation): string {
  const content = conversation.last?.content;
  if (content === undefined) return "";
  if (content.kind === "text") return content.text;
  if (content.kind === "media") return content.caption ?? content.name ?? "";
  if (content.kind === "deleted") return strings.message_deleted;
  return "";
}

/** What a message shows: the text of text, reply and media bodies; null for bodies that are not bubbles (edits, reactions, timers). */
export function messageText(message: Message): string | null {
  const { body } = message.envelope;
  if ((body.kind === "text" || body.kind === "reply") && typeof body.text === "string") {
    return body.text;
  }
  if (body.kind === "media") {
    const shown = body.caption ?? body.name;
    return typeof shown === "string" ? shown : "";
  }
  return null;
}
