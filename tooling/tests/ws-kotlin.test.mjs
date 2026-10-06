// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, ROOT } from "../lib/repo.mjs";
import { emit, OUTPUT } from "../ws-kotlin.mjs";

/** @param {Record<string, any>} members tag → member schema */
function spec(members) {
  /** @type {Record<string, string>} */
  const mapping = {};
  /** @type {Record<string, any>} */
  const schemas = {};
  for (const [tag, schema] of Object.entries(members)) {
    const name = `${tag[0]?.toUpperCase()}${tag.slice(1)}Frame`;
    mapping[tag] = `#/components/schemas/${name}`;
    schemas[name] = schema;
  }
  schemas.WsFrame = { oneOf: [], discriminator: { propertyName: "type", mapping } };
  return { components: { schemas } };
}

/** @param {string} tag @param {Record<string, any>} [props] @param {string[]} [required] */
const frame = (tag, props = {}, required = []) => ({
  type: "object",
  properties: { type: { type: "string", enum: [tag] }, ...props },
  required: ["type", ...required],
});

describe("ws-kotlin", () => {
  it("the committed Kotlin matches api/openapi.json", () => {
    const committed = readFileSync(join(ROOT, OUTPUT), "utf8");
    expect(emit(readJson("api/openapi.json"))).toBe(committed);
  });

  it("emits every frame of the delivery protocol (decision 0015)", () => {
    const kotlin = emit(readJson("api/openapi.json"));
    for (const tag of ["hello", "notify", "ack", "typing", "ping", "pong"]) {
      expect(kotlin).toContain(`@SerialName("${tag}")`);
    }
    expect(kotlin).toMatch(
      /data class TypingFrame\(\s+val conversationId: String,[\s\S]*?val ciphertext: String,/,
    );
  });

  it("emits a sealed member per tag with its fields", () => {
    const kotlin = emit(
      spec({
        notify: frame(
          "notify",
          { seq: { type: "integer" }, ids: { type: "array", items: { type: "string" } } },
          ["seq"],
        ),
        bye: frame("bye"),
      }),
    );
    expect(kotlin).toContain('@SerialName("notify")\ndata class NotifyFrame(');
    expect(kotlin).toContain("    val seq: Long,\n    val ids: List<String>? = null,\n) : WsFrame");
    expect(kotlin).toContain('@SerialName("bye")\ndata object ByeFrame : WsFrame');
  });

  it("backticks a Kotlin keyword used as a field", () => {
    const kotlin = emit(spec({ x: frame("x", { in: { type: "boolean" } }, ["in"]) }));
    expect(kotlin).toContain("val `in`: Boolean,");
  });

  it("fails on a shape it does not map", () => {
    const nested = spec({ x: frame("x", { inner: { type: "object" } }) });
    expect(() => emit(nested)).toThrow(/XFrame.inner: unsupported schema/);
    const bytes = spec({ x: frame("x", { blob: { type: "string", format: "byte" } }) });
    expect(() => emit(bytes)).toThrow(/unsupported schema/);
  });

  it("fails when a member's type literal disagrees with its tag", () => {
    const wrong = spec({ x: frame("y") });
    expect(() => emit(wrong)).toThrow(/must be the literal "x"/);
  });

  it("fails without a discriminator on type", () => {
    expect(() => emit({ components: { schemas: { WsFrame: { oneOf: [] } } } })).toThrow(
      /needs a discriminator/,
    );
  });
});
