// @ts-check
import { describe, expect, it } from "vitest";
import { findInSource, findViolations, stripRust } from "../core-dto-guard.mjs";

const FILE = "core/ffi/src/x.rs";
const rules = (/** @type {string} */ source, exempt = {}) =>
  findInSource(FILE, source, exempt).map((v) => `${v.rule}:${v.line}`);

const from = (/** @type {string} */ body, source = "api::Foo", target = "Foo") =>
  `impl From<${source}> for ${target} {\n    fn from(value: ${source}) -> Self {\n${body}\n    }\n}\n`;

describe("core-dto-guard", () => {
  it("passes on the repo as it is", () => {
    const { violations, scanned } = findViolations();
    expect(scanned).toBeGreaterThan(3);
    expect(violations).toEqual([]);
  });

  it("fails on a field read of the parameter", () => {
    expect(rules(from("        Self { a: value.a }"))).toEqual(["field-read:3"]);
    expect(rules(from("        Self { a: value\n            .a }"))).toEqual(["field-read:3"]);
  });

  it("fails on a field read of a closure parameter", () => {
    const body =
      "        let api::Foo { items } = value;\n        Self { items: items.into_iter().map(|i| Item { n: i.n }).collect() }";
    expect(rules(from(body))).toEqual(["field-read:4"]);
  });

  it("fails on a rest pattern in a destructuring of the parameter", () => {
    expect(rules(from("        let api::Foo { a, .. } = value;\n        Self { a }"))).toEqual([
      "rest-pattern:3",
    ]);
  });

  it("fails on a wildcard arm in a match on the parameter", () => {
    const body =
      "        match value {\n            api::Foo::A => Self::A,\n            _ => Self::B,\n        }";
    expect(rules(from(body))).toEqual(["wildcard-arm:5"]);
  });

  it("passes an exhaustive destructuring, a method call and an exhaustive match", () => {
    expect(
      rules(from("        let api::Foo { a, b: _ } = value;\n        Self { a: a.clone() }")),
    ).toEqual([]);
    expect(rules(from("        Self { a: value.to_string() }"))).toEqual([]);
    const body =
      "        match value {\n            api::Foo::A => Self::A,\n            api::Foo::B => Self::B,\n        }";
    expect(rules(from(body))).toEqual([]);
  });

  it("ignores a read named in a comment or a string", () => {
    expect(
      rules(from('        // value.a would drift\n        let _s = "value.a";\n        Self {}')),
    ).toEqual([]);
  });

  it("does not take a lifetime for a char literal", () => {
    expect(stripRust("fn f<'a>(x: &'a str) -> char { 'x' }")).toBe(
      "fn f<'a>(x: &'a str) -> char {     }",
    );
  });

  it("skips a conversion named in EXEMPT", () => {
    const key = `${FILE}::From<api::Foo> for Foo`;
    expect(rules(from("        Self { a: value.a }"), { [key]: "foreign type" })).toEqual([]);
  });

  it("scans every From, not only the first", () => {
    const two = from("        Self { a: value.a }") + from("        Self { b: value.b }");
    expect(rules(two)).toHaveLength(2);
  });
});
