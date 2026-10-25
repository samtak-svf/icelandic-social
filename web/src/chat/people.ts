import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item, Person } from "../generated/core.d.ts";

/** A conversation's title: its name, else its members' names, else "only you". */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.name !== null && conversation.name !== "") return conversation.name;
  const named = conversation.members
    .map((m) => m.name)
    .filter((n): n is string => n !== null && n !== "");
  return named.length > 0 ? named.join(", ") : strings.conversation_alone_title;
}

/** A person's name, or the word for someone without one. */
function shownName(person: Person): string {
  return person.name !== null && person.name !== "" ? person.name : strings.person_unnamed;
}

/** The first word of a person's name, as a group's preview names the sender. */
function firstName(person: Person): string {
  return person.name?.split(" ").find((w) => w !== "") ?? strings.person_unnamed;
}

/** Several people, named and joined by commas. */
function names(people: Person[]): string {
  return people.map(shownName).join(", ");
}

/** A group has more than one other member, as on the apps. */
export function isGroup(conversation: Conversation): boolean {
  return conversation.members.length > 1;
}

const HOUR = 3_600;
const DAY = 86_400;

/** A disappearing timer: whole days when it is, else hours (decision 0022). */
function duration(seconds: number): string {
  if (seconds % DAY === 0) return strings.duration_days({ count: seconds / DAY });
  return strings.duration_hours({ count: Math.max(1, Math.floor(seconds / HOUR)) });
}

/**
 * Any item as one line, the list's and a card's: never a post's text (decision
 * 0040) or a place (0059), and each card names who did it.
 */
export function itemLine(item: Item, group: boolean): string {
  const { content } = item;
  switch (content.kind) {
    case "text":
      return content.text;
    case "media":
      return content.caption ?? (content.mime.startsWith("image/") ? strings.photo : strings.file);
    case "deleted":
      return strings.message_deleted;
    case "post":
      return strings.post_shared;
    case "location":
      return strings.location;
    case "unreadable":
      return strings.item_unreadable;
    default:
      // members, timer or name: a new kind would not type-check here.
      return cardLine(content, item.sender, group);
  }
}

type CardContent = Extract<Item["content"], { kind: "members" | "timer" | "name" }>;

/** A card's line: who joined, left or got a device; the timer; the name. */
function cardLine(content: CardContent, sender: Person, group: boolean): string {
  const who = shownName(sender);
  switch (content.kind) {
    case "members":
      return membersLine(content, group);
    case "timer":
      return content.seconds === null
        ? strings.disappearing_off_card({ name: who })
        : strings.disappearing_set_card({ name: who, duration: duration(content.seconds) });
    default:
      return content.name === null
        ? strings.name_cleared_card({ who })
        : strings.name_set_card({ who, name: content.name });
  }
}

/** Added, removed (worded for a 1:1 too), or a member's new device. */
function membersLine(content: Extract<CardContent, { kind: "members" }>, group: boolean): string {
  if (content.added.length > 0) return strings.member_added_card({ name: names(content.added) });
  if (content.removed.length === 0)
    return strings.new_device_card({ name: names(content.devices) });
  const name = names(content.removed);
  return group
    ? strings.member_removed_card({ name })
    : strings.member_removed_card_direct({ name });
}

/** The list's preview: what was said says who said it, you or a group's sender. */
export function previewLine(item: Item, group: boolean): string {
  const line = itemLine(item, group);
  const said = ["text", "media", "post", "location"].includes(item.content.kind);
  if (!said) return line;
  if (item.own) return strings.last_line_own({ text: line });
  if (group) return strings.last_line_sender({ name: firstName(item.sender), text: line });
  return line;
}

/** Who read the reader's message: the word in a 1:1, the count in a group (0022). */
export function readLine(count: number, group: boolean): string {
  return group ? strings.read_by_count({ count }) : strings.read_marker;
}

/** A card says what happened to the conversation (members, timer, name), not what someone said. */
export function isCard(item: Item): boolean {
  const { kind } = item.content;
  return kind === "members" || kind === "timer" || kind === "name";
}
