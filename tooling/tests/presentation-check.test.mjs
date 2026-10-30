// @ts-check
import { describe, expect, it } from "vitest";
import { check } from "../presentation-check.mjs";
import { readJson } from "../lib/repo.mjs";

const vectors = () => readJson("api/presentation.vectors.json");
const contract = () => readJson("brand/strings.contract.json");

describe("presentation-check", () => {
  it("passes the committed vectors", () => {
    expect(check(vectors(), contract())).toEqual([]);
  });

  it("fails a strings key the contract lacks", () => {
    const edited = vectors();
    edited.relativeTime[2].key = "time_fortnights";
    expect(check(edited, contract())).toEqual([
      "presentation.vectors.json relativeTime[2]: key time_fortnights is not in the strings contract",
    ]);
  });

  it("fails a count the key cannot take and a count it lacks", () => {
    const edited = vectors();
    edited.relativeTime[0].count = 2;
    delete edited.relativeTime[2].count;
    expect(check(edited, contract())).toEqual([
      "presentation.vectors.json relativeTime[0]: time_now has no {count}",
      "presentation.vectors.json relativeTime[2]: time_minutes needs a whole count of 1 or more",
    ]);
  });

  it("fails an instant that does not parse and a section with no cases", () => {
    const edited = vectors();
    edited.stamp[0].at = "2026-13-45T00:00:00Z";
    edited.problem = [];
    expect(check(edited, contract())).toEqual([
      "presentation.vectors.json stamp[0]: at is not a UTC instant",
      'presentation.vectors.json has no "problem" cases',
    ]);
  });

  it("fails rather than pass on a contract with no keys", () => {
    expect(check(vectors(), {})).toEqual(["brand/strings.contract.json has no keys"]);
  });

  it("fails a notice whose key does not follow its kind and actors", () => {
    const edited = vectors();
    const two = edited.notice.findIndex((/** @type {any} */ c) => c.key === "notice_comment_two");
    edited.notice[two].key = "notice_comment";
    expect(check(edited, contract())).toEqual([
      `presentation.vectors.json notice[${two}]: comment with 2 actors reads notice_comment_two, not notice_comment`,
      `presentation.vectors.json notice[${two}]: args name, other differ from notice_comment's placeholders name`,
    ]);
  });

  it("fails a moderated notice whose key does not follow its action", () => {
    const edited = vectors();
    const upheld = edited.notice.findIndex(
      (/** @type {any} */ c) => c.key === "notice_review_upheld",
    );
    edited.notice[upheld].key = "notice_moderated";
    expect(check(edited, contract())).toEqual([
      `presentation.vectors.json notice[${upheld}]: moderated with 0 actors reads notice_review_upheld, not notice_moderated`,
    ]);
  });

  it("fails notice args that differ from the key's placeholders, a wrong count and a wrong badge", () => {
    const edited = vectors();
    const many = edited.notice.findIndex((/** @type {any} */ c) => c.key === "notice_reply_many");
    edited.notice[many].args.count = 3;
    const one = edited.notice.findIndex((/** @type {any} */ c) => c.key === "notice_reaction");
    edited.notice[one].args.other = "Jón";
    edited.notice[one].badge = "comment";
    expect(check(edited, contract())).toEqual([
      `presentation.vectors.json notice[${many}]: count is actorCount minus one, 2, not 3`,
      `presentation.vectors.json notice[${one}]: args name, other differ from notice_reaction's placeholders name`,
      `presentation.vectors.json notice[${one}]: reaction's badge is emoji, not comment`,
    ]);
  });
});
