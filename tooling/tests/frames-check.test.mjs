// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUST_FRAMES,
  check,
  clientSources,
  handTypedBreakpoints,
  rustSpecs,
} from "../frames-check.mjs";
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
      `${RUST_FRAMES} lacks MEDIUM_FROM`,
      `${RUST_FRAMES} lacks EXPANDED_FROM`,
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

  it("passes the committed size classes, Rust constants and client sources", () => {
    expect(openapi()["x-size-classes"]).toEqual({ medium: 600, expanded: 840 });
    expect(check(openapi(), vectors(), rust(), clientSources())).toEqual([]);
  });

  it("fails an openapi.json without size classes, or with them out of order", () => {
    const missing = openapi();
    delete missing["x-size-classes"];
    expect(check(missing, vectors())).toEqual(["api/openapi.json has no x-size-classes"]);
    const reversed = openapi();
    reversed["x-size-classes"] = { medium: 840, expanded: 600 };
    expect(check(reversed, vectors())).toEqual([
      'x-size-classes needs whole widths with 0 < medium < expanded, not {"medium":840,"expanded":600}',
    ]);
  });

  it("fails a Rust size-class constant that differs from the contract or is missing", () => {
    const moved = rust().replace(
      "pub const EXPANDED_FROM: u32 = 840;",
      "pub const EXPANDED_FROM: u32 = 900;",
    );
    expect(moved).not.toBe(rust());
    expect(check(openapi(), vectors(), moved)).toEqual([
      `${RUST_FRAMES} EXPANDED_FROM is 900, x-size-classes says 840`,
    ]);
    const gone = rust().replace(/^pub const MEDIUM_FROM.*$/m, "");
    expect(check(openapi(), vectors(), gone)).toEqual([`${RUST_FRAMES} lacks MEDIUM_FROM`]);
  });

  it("fails every shape of a hand-typed breakpoint in a client source", () => {
    const classes = { medium: 600, expanded: 840 };
    const lines = [
      'const WIDE = "(min-width: 840px)";',
      '<div className="min-[600px]:grid-cols-3" />',
      "@media (max-width: 600px) {",
      "if (width < 840) return;",
      "if widthDp >= 600 {",
      "const val SIDE_BY_SIDE_DP = 600",
      "static let EXPANDED_FROM: CGFloat = 840",
    ];
    const problems = handTypedBreakpoints(
      lines.map((text, index) => ({ path: `client${index}.ts`, text })),
      classes,
    );
    expect(problems.map((problem) => problem.split(" ")[0])).toEqual(
      lines.map((_, index) => `client${index}.ts:1`),
    );
  });

  it("leaves comments, other numbers and generated widths alone", () => {
    const text = [
      "// the medium class begins at 600 dp",
      " * expanded is 840 and wider",
      "const MAX_IMAGE = 1600;",
      "const padding = 600 + offset;",
      '<div className="w-[600px]" />',
    ].join("\n");
    expect(
      handTypedBreakpoints([{ path: "client.ts", text }], { medium: 600, expanded: 840 }),
    ).toEqual([]);
  });

  it("fails a scan that found no client source rather than passing on nothing", () => {
    expect(check(openapi(), vectors(), undefined, [])).toEqual([
      "no client source was found to scan for breakpoints",
    ]);
  });
});
