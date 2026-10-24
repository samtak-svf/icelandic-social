import { describe, expect, it } from "vitest";
import { SIZE_CLASSES } from "../generated/frames.ts";
import { layoutOf } from "./layout.ts";

describe("layout", () => {
  it("keeps the bar and one column on a compact window", () => {
    expect(layoutOf(SIZE_CLASSES.medium - 1)).toEqual({
      navigation: "bar",
      community: "column",
      memberPictures: 5,
      manage: "one-screen",
      featured: "strip",
      hub: "tabs",
      create: "form",
      tabs: "scroll",
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

  it("splits Stjórna into pages only beside a side navigation, on expanded", () => {
    expect(layoutOf(SIZE_CLASSES.expanded - 1).manage).toBe("one-screen");
    expect(layoutOf(SIZE_CLASSES.expanded).manage).toBe("side-nav");
  });

  it("moves the featured posts from a strip above the feed into the aside from expanded", () => {
    expect(layoutOf(SIZE_CLASSES.medium).featured).toBe("strip");
    expect(layoutOf(SIZE_CLASSES.expanded - 1).featured).toBe("strip");
    expect(layoutOf(SIZE_CLASSES.expanded).featured).toBe("aside");
  });

  it("lists the communities in a column beside the feed, and previews a new one, only on expanded", () => {
    for (const width of [412, SIZE_CLASSES.medium, SIZE_CLASSES.expanded - 1]) {
      expect(layoutOf(width)).toMatchObject({ hub: "tabs", create: "form" });
    }
    expect(layoutOf(SIZE_CLASSES.expanded)).toMatchObject({
      hub: "column",
      create: "form-and-preview",
    });
  });

  it("scrolls the community's tabs sideways on a compact window only", () => {
    expect(layoutOf(SIZE_CLASSES.medium - 1).tabs).toBe("scroll");
    expect(layoutOf(SIZE_CLASSES.medium).tabs).toBe("row");
    expect(layoutOf(SIZE_CLASSES.expanded).tabs).toBe("row");
  });

  it("never shows fewer members' pictures on a wider window", () => {
    const counts = [390, SIZE_CLASSES.medium, SIZE_CLASSES.expanded].map(
      (w) => layoutOf(w).memberPictures,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });
});
