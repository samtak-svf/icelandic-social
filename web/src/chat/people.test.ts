import { expect, test } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Content, Conversation, Item } from "../generated/core.d.ts";
import {
  canSend,
  conversationBanner,
  canChangeGroup,
  conversationTitle,
  isCard,
  isGroup,
  itemLine,
  previewLine,
  readLine,
} from "./people.ts";

const person = (name: string | null) => ({ account: "a", name, verified: false, photo: null });
const conversation = (over: Partial<Conversation>): Conversation => ({
  id: "c",
  state: "active",
  name: null,
  photo: null,
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
  readHere: [],
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

test("members, timer, name and photo items are cards in the thread; what someone said is not", () => {
  expect(isCard(item({ kind: "members", added: [], removed: [], devices: [] }))).toBe(true);
  expect(isCard(item({ kind: "timer", seconds: 60 }))).toBe(true);
  expect(isCard(item({ kind: "name", name: null }))).toBe(true);
  expect(isCard(item({ kind: "photo", set: true }))).toBe(true);
  expect(isCard(item({ kind: "text", text: "hæ", replyTo: null }))).toBe(false);
  expect(isCard(item({ kind: "post", postId: "p" }))).toBe(false);
  expect(isCard(item({ kind: "deleted" }))).toBe(false);
});

test("every kind of item has a line in the list, never a post's text or a place", () => {
  const ann = person("Ann Jónsdóttir");
  const text = { kind: "text", text: "hæ", replyTo: null } as const;
  const photo = {
    kind: "media",
    mime: "image/jpeg",
    size: 1,
    name: "a.jpg",
    caption: null,
  } as const;
  expect(itemLine(item(text), true)).toBe("hæ");
  expect(itemLine(item(photo), true)).toBe(strings.photo);
  expect(itemLine(item({ ...photo, caption: "mynd" }), true)).toBe("mynd");
  expect(itemLine(item({ ...photo, mime: "application/pdf" }), true)).toBe(strings.file);
  expect(itemLine(item({ kind: "deleted" }), true)).toBe(strings.message_deleted);
  expect(itemLine(item({ kind: "post", postId: "p" }), true)).toBe(strings.post_shared);
  const place = {
    kind: "location",
    latE6: 64_000_000,
    lonE6: -21_000_000,
    accuracy: null,
  } as const;
  expect(itemLine(item(place), true)).toBe(strings.location);
  expect(itemLine(item({ kind: "unreadable", code: "x" }), true)).toBe(strings.item_unreadable);
  const members = { added: [], removed: [], devices: [] };
  expect(itemLine(item({ kind: "members", ...members, added: [ann, person(null)] }), true)).toBe(
    strings.member_added_card({ name: `Ann Jónsdóttir, ${strings.person_unnamed}` }),
  );
  expect(itemLine(item({ kind: "members", ...members, removed: [ann] }), true)).toBe(
    strings.member_removed_card({ name: "Ann Jónsdóttir" }),
  );
  expect(itemLine(item({ kind: "members", ...members, removed: [ann] }), false)).toBe(
    strings.member_removed_card_direct({ name: "Ann Jónsdóttir" }),
  );
  expect(itemLine(item({ kind: "members", ...members, devices: [ann] }), true)).toBe(
    strings.new_device_card({ name: "Ann Jónsdóttir" }),
  );
  expect(itemLine(item({ kind: "timer", seconds: 2 * 86_400 }), true)).toBe(
    strings.disappearing_set_card({ name: "Ása", duration: strings.duration_days({ count: 2 }) }),
  );
  expect(itemLine(item({ kind: "timer", seconds: 1800 }), true)).toBe(
    strings.disappearing_set_card({ name: "Ása", duration: strings.duration_hours({ count: 1 }) }),
  );
  expect(itemLine(item({ kind: "timer", seconds: null }), true)).toBe(
    strings.disappearing_off_card({ name: "Ása" }),
  );
  expect(itemLine(item({ kind: "name", name: "Hópur" }), true)).toBe(
    strings.name_set_card({ who: "Ása", name: "Hópur" }),
  );
  expect(itemLine(item({ kind: "name", name: null }), true)).toBe(
    strings.name_cleared_card({ who: "Ása" }),
  );
  expect(itemLine(item({ kind: "photo", set: true }), true)).toBe(
    strings.photo_set_card({ who: "Ása" }),
  );
  expect(itemLine(item({ kind: "photo", set: false }), true)).toBe(
    strings.photo_cleared_card({ who: "Ása" }),
  );
});

test("the preview says who said it: you, or in a group the sender's first name", () => {
  const text = { kind: "text", text: "hæ", replyTo: null } as const;
  const sender = person("Ása Björk Jónsdóttir");
  expect(previewLine({ ...item(text), own: true }, false)).toBe(
    strings.last_line_own({ text: "hæ" }),
  );
  expect(previewLine({ ...item(text), sender }, true)).toBe(
    strings.last_line_sender({ name: "Ása", text: "hæ" }),
  );
  expect(previewLine({ ...item(text), sender }, false)).toBe("hæ");
  // A card already names who did it.
  const card = item({ kind: "timer", seconds: null });
  expect(previewLine({ ...card, own: true }, true)).toBe(itemLine(card, true));
});

test("who read the reader's message: the word in a 1:1, the count in a group", () => {
  expect(readLine(1, false)).toBe(strings.read_marker);
  expect(readLine(3, true)).toBe(strings.read_by_count({ count: 3 }));
});

test("a group is a conversation with more than one other member, or a name, as on the apps", () => {
  expect(isGroup(conversation({ members: [person("Ása")] }))).toBe(false);
  expect(isGroup(conversation({ members: [person("Ása"), person("Bo")] }))).toBe(true);
  expect(isGroup(conversation({ name: "Klúbbur", members: [person("Ása")] }))).toBe(true);
});

test("a group can be changed only while this device takes part in it", () => {
  const two = [person("Ása"), person("Bo")];
  expect(canChangeGroup(conversation({ members: two }))).toBe(true);
  expect(canChangeGroup(conversation({ members: two, state: "left" }))).toBe(false);
  expect(canChangeGroup(conversation({ members: two, state: "removed" }))).toBe(false);
  expect(canChangeGroup(conversation({ members: [person("Ása")] }))).toBe(false);
});

test("a quiet conversation says why, in the apps' words, and takes no message", () => {
  const ann = person("Ann");
  const at = (state: Conversation["state"], members = [ann]) => conversation({ state, members });
  expect(conversationBanner(at("stale"))).toBe(strings.conversation_stale_banner);
  expect(conversationBanner(at("excluded"))).toBe(strings.conversation_excluded_banner);
  expect(conversationBanner(at("removed"))).toBe(strings.conversation_removed_banner);
  expect(conversationBanner(at("left"))).toBe(strings.left_banner);
  expect(conversationBanner(at("active", []))).toBe(strings.conversation_alone_banner);
  expect(conversationBanner(at("active"))).toBeNull();
  expect(conversationBanner(at("new"))).toBeNull();
  expect(canSend(at("active"))).toBe(true);
  expect(canSend(at("new"))).toBe(true);
  for (const state of ["stale", "excluded", "removed", "left"] as const) {
    expect(canSend(at(state))).toBe(false);
  }
  expect(canSend(at("active", []))).toBe(false);
});
