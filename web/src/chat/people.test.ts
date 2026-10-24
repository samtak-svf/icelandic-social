import { expect, test } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Message } from "../generated/core.d.ts";
import { conversationTitle, messageText } from "./people.ts";

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
const message = (body: Message["envelope"]["body"]): Message => ({
  conversation: "c",
  seq: 1,
  senderAccount: "a",
  senderDevice: "d",
  envelope: { id: "e", ts: 0, body },
  own: false,
});

test("a conversation is titled by its name, else its members, else only you", () => {
  expect(conversationTitle(conversation({ name: "Hópur" }))).toBe("Hópur");
  expect(
    conversationTitle(conversation({ members: [person("Ása"), person(null), person("Bo")] })),
  ).toBe("Ása, Bo");
  expect(conversationTitle(conversation({}))).toBe(strings.conversation_alone_title);
});

test("text and reply bodies show their text, edits and reactions show nothing", () => {
  expect(messageText(message({ kind: "text", text: "hæ" }))).toBe("hæ");
  expect(messageText(message({ kind: "reply", to: "x", text: "já" }))).toBe("já");
  expect(
    messageText(message({ kind: "reaction", target: "x", emoji: "+", remove: false })),
  ).toBeNull();
});
