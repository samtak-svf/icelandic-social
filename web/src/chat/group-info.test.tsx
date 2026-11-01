import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Person } from "../generated/core.d.ts";
import { ConversationInfo, type GroupControls, type PhotoProblem } from "./group-info.tsx";

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
const controls = (over: Partial<GroupControls> = {}): GroupControls => ({
  dialog: null,
  problem: null,
  add: nop,
  ask: nop,
  cancel: nop,
  confirm: nop,
  ...over,
});
function render(
  c: Conversation,
  over: {
    confirming?: boolean;
    problem?: PhotoProblem | null;
    controls?: GroupControls | null;
  } = {},
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
      controls={over.controls === undefined ? controls() : over.controls}
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

  it("is read-only without controls: a left group offers no change at all", () => {
    const html = render(conversation(pair, "group-photo/c-1.jpg"), { controls: null });
    expect(html).toContain("Siggi");
    for (const word of [
      strings.add_people,
      strings.group_name,
      strings.remove_member,
      strings.leave_group,
      strings.group_photo_change,
    ]) {
      expect(html).not.toContain(word);
    }
    expect(html).not.toContain('type="file"');
  });
});

describe("a group's changes on the info page (0078)", () => {
  const group = conversation(pair, null);

  it("offers add, name, remove each member and leave", () => {
    const html = render(group);
    expect(html).toContain(strings.add_people);
    expect(html).toContain(strings.group_name);
    expect(html.split(strings.remove_member).length - 1).toBe(pair.length);
    expect(html).toContain(strings.leave_group);
  });

  it("offers none of them in a conversation of two", () => {
    const html = render(conversation([person("a-1", "Gunna")], null));
    expect(html).not.toContain(strings.add_people);
    expect(html).not.toContain(strings.leave_group);
    expect(html).not.toContain(strings.remove_member);
  });

  it("asks for the name with the current one and a way to clear it", () => {
    const html = render(group, {
      controls: controls({ dialog: { kind: "rename", draft: "Bókaklúbbur" } }),
    });
    expect(html).toContain(strings.group_name_title);
    expect(html).toContain('value="Bókaklúbbur"');
    expect(html).toContain(`>${strings.group_name_remove}<`);
    expect(html).toContain(strings.save);
  });

  it("offers no way to clear a name the group does not have", () => {
    const html = render(
      { ...group, name: null },
      { controls: controls({ dialog: { kind: "rename", draft: "" } }) },
    );
    expect(html).not.toContain(`>${strings.group_name_remove}<`);
  });

  it("asks before removing a member, naming them", () => {
    const html = render(group, {
      controls: controls({ dialog: { kind: "remove", person: person("a-2", "Siggi") } }),
    });
    expect(html).toContain(strings.remove_member_confirm({ name: "Siggi" }));
    expect(html).toContain(strings.cancel);
  });

  it("asks before leaving", () => {
    const html = render(group, { controls: controls({ dialog: { kind: "leave" } }) });
    expect(html).toContain(strings.leave_group_confirm);
  });

  it("says why a change failed, as a send does", () => {
    expect(render(group, { controls: controls({ problem: "unreachable" }) })).toContain(
      strings.error_unreachable,
    );
    expect(render(group, { controls: controls({ problem: "failed" }) })).toContain(
      strings.error_generic,
    );
  });
});
