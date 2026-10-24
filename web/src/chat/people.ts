import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item } from "../generated/core.d.ts";

/** A conversation's title: its name, else its members' names, else "only you". */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.name !== null && conversation.name !== "") return conversation.name;
  const names = conversation.members
    .map((m) => m.name)
    .filter((n): n is string => n !== null && n !== "");
  return names.length > 0 ? names.join(", ") : strings.conversation_alone_title;
}

/** The last item as a line of text; "" when there is none or it has no text. */
export function lastLine(conversation: Conversation): string {
  const last = conversation.last;
  return last === null ? "" : (itemText(last) ?? "");
}

/**
 * What an item shows as a bubble: the text of text, the caption or name of
 * media, a note for a deleted message; null for the cards (members, timer,
 * name) and kinds the web does not draw yet.
 */
export function itemText(item: Item): string | null {
  const { content } = item;
  if (content.kind === "text") return content.text;
  if (content.kind === "media") return content.caption ?? content.name ?? "";
  if (content.kind === "deleted") return strings.message_deleted;
  return null;
}
