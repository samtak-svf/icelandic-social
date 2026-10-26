import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Person } from "../generated/core.d.ts";
import { ConversationRow } from "./conversation-row.tsx";
import { isGroup } from "./people.ts";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

// The hook asks the worker; here it answers from `stored`, as it does for a
// group and never for a 1:1.
let stored: string | null = null;
vi.mock("./group-photo.ts", () => ({
  useGroupPhoto: (c: Conversation) => (c.members.length > 1 ? stored : null),
}));

const person = (account: string, name: string): Person => ({
  account,
  name,
  verified: false,
  photo: null,
});
const conversation = (over: Partial<Conversation>): Conversation => ({
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
const render = (c: Conversation) =>
  renderToStaticMarkup(<ConversationRow conversation={c} typing={false} now={0} />);
const group = (photo: string | null) =>
  conversation({
    name: "Bókaklúbbur",
    photo,
    members: [person("a-1", "Gunna"), person("a-2", "Siggi")],
  });

describe("the conversation row's picture (0094)", () => {
  beforeEach(() => {
    stored = null;
  });

  it("shows a group's photo", () => {
    stored = "blob:group";
    const c = group("group-photo/c-1.jpg");
    expect(isGroup(c)).toBe(true);
    expect(render(c)).toContain('src="blob:group"');
  });

  it("shows a group without one as the initial of its title", () => {
    const html = render(group(null));
    expect(html).not.toContain("<img");
    expect(html).toContain(">B<");
  });

  it("shows a 1:1 as the other person, never a group photo", () => {
    stored = "blob:group";
    const html = render(conversation({ members: [person("a-1", "Gunna")] }));
    expect(html).not.toContain("blob:group");
    expect(html).toContain(">G<");
  });
});
