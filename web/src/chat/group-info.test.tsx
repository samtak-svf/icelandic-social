import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Person } from "../generated/core.d.ts";
import { ConversationInfo, type PhotoProblem } from "./group-info.tsx";

vi.mock("./group-photo.ts", () => ({ useGroupPhoto: () => null }));

const person = (account: string, name: string): Person => ({
  account,
  name,
  verified: false,
  photo: null,
});
const conversation = (members: Person[], photo: string | null): Conversation => ({
  id: "c-1",
  state: "active",
  name: members.length > 1 ? "Bókaklúbbur" : null,
  photo,
  members,
  last: null,
  unread: 0,
  timer: null,
  mute: { kind: "off" },
});
const pair = [person("a-1", "Gunna"), person("a-2", "Siggi")];
const nop = () => undefined;
function render(
  c: Conversation,
  over: { confirming?: boolean; problem?: PhotoProblem | null } = {},
) {
  return renderToStaticMarkup(
    <ConversationInfo
      conversation={c}
      confirming={over.confirming ?? false}
      busy={false}
      problem={over.problem ?? null}
      pick={nop}
      askRemove={nop}
      confirmRemove={nop}
      cancelRemove={nop}
    />,
  );
}

describe("a conversation's info page (0094)", () => {
  it("offers a group without a photo to choose one, with nothing to remove", () => {
    const html = render(conversation(pair, null));
    expect(html).toContain(strings.group_photo_choose);
    expect(html).not.toContain(strings.group_photo_remove);
    expect(html).toContain(strings.group_photo_seen_by_members);
    expect(html).toContain("Siggi");
  });

  it("offers a group with a photo to change or remove it", () => {
    const html = render(conversation(pair, "group-photo/c-1.jpg"));
    expect(html).toContain(strings.group_photo_change);
    expect(html).toContain(strings.group_photo_remove);
    expect(html).toContain('type="file"');
  });

  it("asks before removing, and only then offers the removal itself", () => {
    const c = conversation(pair, "group-photo/c-1.jpg");
    const before = render(c);
    expect(before).not.toContain(strings.group_photo_remove_confirm);
    const asking = render(c, { confirming: true });
    expect(asking).toContain(strings.group_photo_remove_confirm);
    expect(asking).toContain(strings.cancel);
  });

  it("shows no photo control for a 1:1", () => {
    const html = render(conversation([person("a-1", "Gunna")], null));
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain(strings.group_photo_choose);
    expect(html).not.toContain(strings.group_photo_seen_by_members);
  });

  it("says why a change failed", () => {
    const c = conversation(pair, null);
    expect(render(c, { problem: "unsupported" })).toContain(strings.group_photo_unsupported);
    expect(render(c, { problem: "failed" })).toContain(strings.group_photo_failed);
  });
});
