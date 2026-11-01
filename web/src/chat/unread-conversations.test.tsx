import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item, Person } from "../generated/core.d.ts";
import { unreadRows } from "./unread.ts";
import { UnreadConversations } from "./unread-conversations.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("./group-photo.ts", () => ({ useGroupPhoto: () => null }));

const person: Person = { account: "a-1", name: "Ein Manneskja", verified: false, photo: null };
const secret: Item = {
  seq: 1,
  envelopeId: null,
  sender: person,
  own: false,
  ts: 1,
  receivedAt: 1,
  status: "sent",
  content: { kind: "text", text: "leyndarmálið", replyTo: null },
  edited: false,
  reactions: [],
  readBy: 0,
  readHere: [],
  expiresAt: null,
  forwarded: false,
};
const row: Conversation = {
  id: "c-1",
  state: "active",
  name: null,
  photo: null,
  members: [person],
  last: secret,
  unread: 2,
  timer: null,
  mute: { kind: "off" },
};

describe("who wrote, on the notifications page (0124)", () => {
  it("names who and how many, and never what", () => {
    const html = renderToStaticMarkup(<UnreadConversations rows={unreadRows([row])} />);
    expect(html).toContain(strings.notifications_conversations_unread);
    expect(html).toContain("Ein Manneskja");
    expect(html).toContain(strings.unread_count({ count: 2 }));
    expect(html).not.toContain("leyndarmálið");
  });

  it("is not there with nothing unread", () => {
    expect(renderToStaticMarkup(<UnreadConversations rows={[]} />)).toBe("");
  });
});
