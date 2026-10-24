import { describe, expect, it } from "vitest";
import { SIZE_CLASSES, sizeClassOf } from "../generated/frames.ts";
import { SIZE_QUERIES } from "./size-class.ts";

describe("size classes", () => {
  it("break below 600, 600 to below 840, from 840", () => {
    expect([390, 599, 600, 839, 840, 1280].map(sizeClassOf)).toEqual([
      "compact",
      "compact",
      "medium",
      "medium",
      "expanded",
      "expanded",
    ]);
  });

  it("match their media queries to the contract's widths", () => {
    expect(SIZE_QUERIES.medium).toBe(`(min-width: ${SIZE_CLASSES.medium}px)`);
    expect(SIZE_QUERIES.expanded).toBe(`(min-width: ${SIZE_CLASSES.expanded}px)`);
  });
});
