import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { listNotice } from "./conversation-list.tsx";

const row: Conversation = {
  id: "c-1",
  state: "active",
  name: null,
  photo: null,
  members: [],
  last: null,
  unread: 0,
  timer: null,
  mute: { kind: "off" },
};

describe("the conversation list's notice (decision 0108)", () => {
  it("never says there are no conversations before the chat has caught up", () => {
    expect(listNotice({ rows: [], caughtUp: false }, false, "backlog")).toEqual({
      text: strings.conversations_catching_up,
      status: true,
    });
    expect(listNotice({ rows: [], caughtUp: false }, false, "history")).toEqual({
      text: strings.device_link_web_receiving,
      status: true,
    });
  });

  it("says so once an empty list was read after catching up", () => {
    expect(listNotice({ rows: [], caughtUp: true }, false, "done")).toEqual({
      text: strings.conversations_empty,
      status: false,
    });
  });

  it("keeps the progress up for an empty list read just before the chat caught up", () => {
    expect(listNotice({ rows: [], caughtUp: false }, false, "done")?.text).toBe(
      strings.conversations_catching_up,
    );
  });

  it("shows the rows with no notice once there are any, and the history wait above them", () => {
    expect(listNotice({ rows: [row], caughtUp: false }, false, "backlog")).toBeNull();
    expect(listNotice({ rows: [row], caughtUp: true }, false, "history")?.text).toBe(
      strings.device_link_web_receiving,
    );
  });

  it("says loading before the first read, and try again on a failure", () => {
    expect(listNotice(null, false, "backlog")?.text).toBe(strings.loading);
    expect(listNotice(null, true, "done")?.text).toBe(strings.try_again);
  });
});
