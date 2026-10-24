// @ts-check
import { describe, expect, it } from "vitest";
import { check } from "../frames-check.mjs";
import { readJson } from "../lib/repo.mjs";

const openapi = () => readJson("api/openapi.json");
const vectors = () => readJson("api/frames.vectors.json");

describe("frames-check", () => {
  it("passes the committed openapi.json and vectors", () => {
    expect(check(openapi(), vectors())).toEqual([]);
  });

  it("fails an openapi.json without the frame specs", () => {
    const document = openapi();
    delete document["x-frame-specs"];
    expect(check(document, vectors())).toEqual(["api/openapi.json has no x-frame-specs"]);
  });

  it("fails a vector for a ratio no frame has, as when a size changes", () => {
    const document = openapi();
    document["x-frame-specs"].cover.expanded = { w: 1600, h: 800 };
    const problems = check(document, vectors());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain("is the ratio of no frame");
  });

  it("fails a size that is not whole pixels", () => {
    const document = openapi();
    document["x-frame-specs"].photo.square = { w: 512.5, h: 512 };
    expect(check(document, vectors())).toContain(
      "x-frame-specs.photo.square is not a whole pixel size",
    );
  });

  it("fails an expected rectangle that leaves its image", () => {
    const set = vectors();
    set.place[0].expected.w = set.place[0].imageW + 1;
    expect(check(openapi(), set).some((p) => p.includes("leaves the image"))).toBe(true);
  });

  it("fails vectors with no cases rather than passing on nothing", () => {
    expect(check(openapi(), { place: [], override: [] })).toEqual([
      'frames.vectors.json has no "place" cases',
      'frames.vectors.json has no "override" cases',
    ]);
  });
});
