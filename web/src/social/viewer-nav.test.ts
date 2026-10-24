import { describe, expect, it } from "vitest";
import { stepBy } from "./viewer-nav.ts";

describe("stepBy", () => {
  it("pages with the arrow keys and stops at the ends", () => {
    expect(stepBy(0, 3, "ArrowRight")).toBe(1);
    expect(stepBy(1, 3, "ArrowLeft")).toBe(0);
    expect(stepBy(2, 3, "ArrowRight")).toBe(2);
    expect(stepBy(0, 3, "ArrowLeft")).toBe(0);
  });

  it("ignores every other key", () => {
    expect(stepBy(1, 3, "Enter")).toBeNull();
  });
});
