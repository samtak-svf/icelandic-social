import { expect, test } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Content, Conversation, Item } from "../generated/core.d.ts";
import { conversationTitle, itemText, lastLine } from "./people.ts";

const person = (name: string | null) => ({ account: "a", name, verified: false, photo: null });
const conversation = (over: Partial<Conversation>): Conversation => ({
  id: "c",
  state: "active",
  name: null,
  members: [],
  last: null,
  unread: 0,
  timer: null,
  mute: { kind: "off" },
  ...over,
});
const item = (content: Content): Item => ({
  seq: 1,
  envelopeId: "e",
  sender: person("Ása"),
  own: false,
  ts: 0,
  receivedAt: 0,
  status: "sent",
  content,
  edited: false,
  reactions: [],
  readBy: 0,
  expiresAt: null,
  forwarded: false,
});

test("a conversation is titled by its name, else its members, else only you", () => {
  expect(conversationTitle(conversation({ name: "Hópur" }))).toBe("Hópur");
  expect(
    conversationTitle(conversation({ members: [person("Ása"), person(null), person("Bo")] })),
  ).toBe("Ása, Bo");
  expect(conversationTitle(conversation({}))).toBe(strings.conversation_alone_title);
});

test("text, media and deleted items show a line, cards show none", () => {
  expect(itemText(item({ kind: "text", text: "hæ", replyTo: null }))).toBe("hæ");
  const photo = { kind: "media", mime: "image/jpeg", size: 1, name: "a.jpg" } as const;
  expect(itemText(item({ ...photo, caption: "mynd" }))).toBe("mynd");
  expect(itemText(item({ ...photo, caption: null }))).toBe("a.jpg");
  expect(itemText(item({ kind: "deleted" }))).toBe(strings.message_deleted);
  expect(itemText(item({ kind: "timer", seconds: 60 }))).toBeNull();
});

test("a conversation's last line is its last item's text, else empty", () => {
  expect(lastLine(conversation({ last: item({ kind: "text", text: "hæ", replyTo: null }) }))).toBe(
    "hæ",
  );
  expect(lastLine(conversation({ last: item({ kind: "name", name: "Hópur" }) }))).toBe("");
  expect(lastLine(conversation({}))).toBe("");
});
