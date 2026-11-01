import { describe, expect, it } from "vitest";
import { newestSeq, toMark } from "./mark-read.ts";

const items = (...seqs: (number | null)[]) => seqs.map((seq) => ({ seq }));

describe("marking a conversation read (0124)", () => {
  it("takes the newest item with a place, past one still being sent", () => {
    expect(newestSeq(items(3, 7, 5, null))).toBe(7);
    expect(newestSeq(items(null))).toBeNull();
    expect(newestSeq([])).toBeNull();
  });

  it("marks the first time, and only again when something newer came", () => {
    expect(toMark("a", { conversation: "a", seq: 4 }, null)).toBe(4);
    const marked = { conversation: "a", seq: 4 };
    expect(toMark("a", { conversation: "a", seq: 4 }, marked)).toBeNull();
    expect(toMark("a", { conversation: "a", seq: 3 }, marked)).toBeNull();
    expect(toMark("a", { conversation: "a", seq: 5 }, marked)).toBe(5);
  });

  it("never marks one conversation with another's newest item", () => {
    expect(toMark("b", { conversation: "a", seq: 9 }, null)).toBeNull();
  });

  it("marks the next conversation whatever was marked in the one before", () => {
    expect(toMark("b", { conversation: "b", seq: 2 }, { conversation: "a", seq: 9 })).toBe(2);
  });

  it("marks nothing before the timeline is read", () => {
    expect(toMark("a", null, null)).toBeNull();
  });
});
