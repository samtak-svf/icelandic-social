import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Notification } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { NoticeRow } from "./notice-row.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const person = (accountId: string, name: string) => ({
  accountId,
  name,
  verified: false,
  photo: null,
  role: null,
});
const row = (change: Partial<Notification> = {}): Notification => ({
  notificationId: "n1",
  kind: "reaction",
  actor: person("a1", "Garðar Pálsson"),
  actors: [person("a1", "Garðar Pálsson")],
  actorCount: 1,
  communityId: "c1",
  postId: "p1",
  commentId: null,
  action: null,
  emoji: "🎉",
  createdAt: Date.now(),
  read: false,
  snippet: "Fundur á morgun",
  announce: false,
  ...change,
});
const actions = {
  open: vi.fn(),
  setRead: vi.fn(),
  remove: vi.fn(),
  kindInApp: vi.fn(),
  communityOff: vi.fn(),
};
const html = (n: Notification) =>
  renderToStaticMarkup(<NoticeRow notification={n} community={undefined} actions={actions} />);

describe("NoticeRow", () => {
  it("tints and dots an unread row and plain-renders a read one", () => {
    expect(html(row())).toContain("bg-muted");
    expect(html(row())).toContain("rounded-full bg-primary");
    expect(html(row({ read: true }))).not.toContain("rounded-full bg-primary");
  });

  it("quotes the snippet, marks the reaction's emoji and names the menu", () => {
    const out = html(row());
    expect(out).toContain(strings.notice_snippet({ text: "Fundur á morgun" }));
    expect(out).toContain("🎉");
    expect(out).toContain(`aria-label="${strings.notice_menu}"`);
  });

  it("names the two newest actors of a group", () => {
    const n = row({
      actors: [person("a1", "Garðar Pálsson"), person("a2", "Anna Jónsdóttir")],
      actorCount: 2,
    });
    expect(html(n)).toContain(
      strings.notice_reaction_two({ name: "Garðar Pálsson", other: "Anna Jónsdóttir" }),
    );
  });
});
