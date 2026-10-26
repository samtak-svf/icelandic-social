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
});
