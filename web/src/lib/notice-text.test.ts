import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { noticeText } from "./notice-text.ts";

const moderated = (action: string | null) => ({
  kind: "moderated" as const,
  action,
  actors: [],
  actorCount: 0,
});

describe("what a row of reports waiting reads", () => {
  it("says they wait, and names no count, reporter or target", () => {
    const said = noticeText({ kind: "reports_waiting", action: null, actors: [], actorCount: 0 });
    expect(said.key).toBe("notice_reports_waiting");
    expect(said.text).toBe(strings.notice_reports_waiting);
    expect(said.args).toEqual({});
    expect(said.badge).toBe("moderator");
  });
});

describe("what a moderated row reads", () => {
  it.each([
    ["decline_anonymous_post", "notice_anonymous_declined"],
    ["review_upheld", "notice_review_upheld"],
    ["review_overturned", "notice_review_overturned"],
    ["clear_account_photo", "notice_account_photo_cleared"],
    ["suspend_account", "notice_account_suspended"],
    ["unsuspend_account", "notice_account_unsuspended"],
    ["remove_post", "notice_moderated"],
    [null, "notice_moderated"],
  ] as const)("%s reads %s, and names nobody", (action, key) => {
    const said = noticeText(moderated(action));
    expect(said.key).toBe(key);
    expect(said.text).toBe(strings[key]);
    expect(said.args).toEqual({});
    expect(said.badge).toBe("moderator");
  });
});

describe("what a friend's row reads", () => {
  const friend = (kind: "friend_request" | "friend_accepted", name: string | null) => ({
    kind,
    action: null,
    actors: name === null ? [null] : [{ accountId: "a1", name, photo: null, verified: false }],
    actorCount: 1,
  });

  it.each([
    ["friend_request", "notice_friend_request"],
    ["friend_accepted", "notice_friend_accepted"],
  ] as const)("%s names the one person, with the friend badge", (kind, key) => {
    const said = noticeText(friend(kind, "Anna"));
    expect(said.key).toBe(key);
    expect(said.text).toBe(strings[key]({ name: "Anna" }));
    expect(said.args).toEqual({ name: "Anna" });
    expect(said.badge).toBe("friend");
  });

  it("says the account is gone when its owner deleted it", () => {
    const said = noticeText(friend("friend_request", null));
    expect(said.args).toEqual({ name: null });
    expect(said.text).toBe(strings.notice_friend_request({ name: strings.person_deleted }));
  });
});
