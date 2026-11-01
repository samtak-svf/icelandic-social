import { describe, expect, it } from "vitest";
import type { Conversation, Item } from "../generated/core.d.ts";
import { unreadRows, unreadTotal } from "./unread.ts";

const row = (over: Partial<Conversation>): Conversation => ({
  id: "c-1",
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

describe("what is unread (0124)", () => {
  it("counts conversations with something unread, and no muted one", () => {
    const rows = unreadRows([
      row({ id: "read" }),
      row({ id: "new", unread: 2 }),
      row({ id: "muted", unread: 5, mute: { kind: "always" } }),
      row({ id: "other", unread: 1 }),
    ]);
    expect(rows.map((c) => c.id)).toEqual(["new", "other"]);
    expect(unreadTotal(rows)).toBe(3);
  });

  it("leaves the last message behind, so it cannot reach another tab", () => {
    const last: Item = {
      seq: 1,
      envelopeId: null,
      sender: { account: "a-1", name: "Ein", verified: false, photo: null },
      own: false,
      ts: 1,
      receivedAt: 1,
      status: "sent",
      content: { kind: "text", text: "orðin", replyTo: null },
      edited: false,
      reactions: [],
      readBy: 0,
      expiresAt: null,
      forwarded: false,
    };
    const [only] = unreadRows([row({ unread: 1, last })]);
    expect(only?.last).toBeNull();
    expect(JSON.stringify(only)).not.toContain("orðin");
  });
});
