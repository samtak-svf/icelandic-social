// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUST_FRAMES, check, rustSpecs } from "../frames-check.mjs";
import { ROOT, readJson } from "../lib/repo.mjs";

const openapi = () => readJson("api/openapi.json");
const vectors = () => readJson("api/frames.vectors.json");

const rust = () => readFileSync(join(ROOT, RUST_FRAMES), "utf8");

describe("frames-check", () => {
  it("passes the committed openapi.json and vectors", () => {
    expect(check(openapi(), vectors())).toEqual([]);
  });

  it("passes the committed Rust constants", () => {
    expect(rustSpecs(rust()).cover?.expanded).toEqual({ w: 1600, h: 600 });
    expect(check(openapi(), vectors(), rust())).toEqual([]);
  });

  it("fails a Rust constant that differs from x-frame-specs", () => {
    const edited = rust().replace("FrameSize { w: 1600, h: 600 }", "FrameSize { w: 1600, h: 640 }");
    expect(edited).not.toBe(rust());
    expect(check(openapi(), vectors(), edited)).toEqual([
      `${RUST_FRAMES} cover.expanded is 1600x640, x-frame-specs says 1600x600`,
    ]);
  });

  it("fails a Rust frame that is missing or extra", () => {
    const without = rust().replace(/^pub const PHOTO_SQUARE.*$/m, "");
    expect(check(openapi(), vectors(), without)).toEqual([
      `${RUST_FRAMES} lacks photo.square of x-frame-specs`,
    ]);
    const extra = `${rust()}\npub const COVER_HUGE: FrameSize = FrameSize { w: 3200, h: 800 };\n`;
    expect(check(openapi(), vectors(), extra)).toEqual([
      `${RUST_FRAMES} has cover.huge, x-frame-specs does not`,
    ]);
  });

  it("fails a Rust source with no constants rather than passing on nothing", () => {
    expect(check(openapi(), vectors(), "// nothing")).toEqual([
      `${RUST_FRAMES} has no frame-size constants`,
    ]);
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
