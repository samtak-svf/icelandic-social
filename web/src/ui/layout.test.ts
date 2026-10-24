import { describe, expect, it } from "vitest";
import { SIZE_CLASSES } from "../generated/frames.ts";
import { layoutOf } from "./layout.ts";

describe("layout", () => {
  it("keeps the bar and one column on a compact window", () => {
    expect(layoutOf(SIZE_CLASSES.medium - 1)).toEqual({
      navigation: "bar",
      community: "column",
      memberPictures: 5,
    });
  });

  it("moves the places to a rail from medium, the facts beside the feed from expanded", () => {
    expect(layoutOf(SIZE_CLASSES.medium)).toMatchObject({
      navigation: "rail",
      community: "column",
    });
    expect(layoutOf(SIZE_CLASSES.expanded - 1).community).toBe("column");
    expect(layoutOf(SIZE_CLASSES.expanded)).toMatchObject({
      navigation: "rail",
      community: "feed-and-aside",
    });
  });

  it("never shows fewer members' pictures on a wider window", () => {
    const counts = [390, SIZE_CLASSES.medium, SIZE_CLASSES.expanded].map(
      (w) => layoutOf(w).memberPictures,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });
});
