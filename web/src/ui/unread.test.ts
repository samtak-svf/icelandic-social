import { describe, expect, it } from "vitest";
import { badgeCount } from "./unread.tsx";

describe("the count in a badge (0109)", () => {
  it("is the number up to 99, then 99+", () => {
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(100)).toBe("99+");
  });
});
