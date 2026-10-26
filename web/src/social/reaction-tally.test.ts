import { describe, expect, it } from "vitest";
import { tally } from "./reaction-tally.ts";

const server = [
  { emoji: "👍", count: 3 },
  { emoji: "🇮🇸", count: 1 },
];

describe("tally", () => {
  it("is the server's list when nothing changed", () => {
    expect(tally(server, null, null).emojis).toEqual(server);
    expect(tally(server, "👍", "👍").total).toBe(4);
  });

  it("moves the caller's reaction from one emoji to another, any emoji", () => {
    const t = tally(server, "👍", "👨‍👩‍👧‍👦");
    expect(t.emojis).toEqual([
      { emoji: "👍", count: 2 },
      { emoji: "🇮🇸", count: 1 },
      { emoji: "👨‍👩‍👧‍👦", count: 1 },
    ]);
    expect(t.count("👨‍👩‍👧‍👦")).toBe(1);
    expect(t.total).toBe(4);
  });

  it("drops an emoji the caller took back when it was the only one", () => {
    const t = tally(server, "🇮🇸", null);
    expect(t.emojis).toEqual([{ emoji: "👍", count: 3 }]);
    expect(t.total).toBe(3);
  });

  it("reorders by count after the change", () => {
    const t = tally(
      [
        { emoji: "😂", count: 1 },
        { emoji: "🙏", count: 1 },
      ],
      null,
      "🙏",
    );
    expect(t.emojis[0]).toEqual({ emoji: "🙏", count: 2 });
  });
});
