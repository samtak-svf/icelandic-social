import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { noticeText } from "./notice-text.ts";

const moderated = (action: string | null) => ({
  kind: "moderated" as const,
  action,
  actors: [],
  actorCount: 0,
});

describe("what a moderated row reads", () => {
  it.each([
    ["decline_anonymous_post", "notice_anonymous_declined"],
    ["review_upheld", "notice_review_upheld"],
    ["review_overturned", "notice_review_overturned"],
    ["clear_account_photo", "notice_account_photo_cleared"],
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
