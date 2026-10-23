// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, ROOT } from "../lib/repo.mjs";
import { emit, forWeb, OUTPUT, tsType } from "../web-api.mjs";

/**
 * A spec of one operation and the given schemas.
 *
 * @param {any} op
 * @param {Record<string, any>} [schemas]
 */
function spec(op, schemas = {}) {
  return { paths: { "/v1/things/{thingId}": { get: op } }, components: { schemas } };
}

describe("web-api", () => {
  it("the committed client matches api/openapi.json", () => {
    const committed = readFileSync(join(ROOT, OUTPUT), "utf8");
    expect(emit(readJson("api/openapi.json"))).toBe(committed);
  });

  it("goes stale when a schema changes", () => {
    const changed = readJson("api/openapi.json");
    changed.components.schemas.Me.properties.extra = { type: "string" };
    expect(emit(changed)).not.toBe(readFileSync(join(ROOT, OUTPUT), "utf8"));
    expect(emit(changed)).toContain("  extra?: string;");
  });

  it("offers a browser what takes the session or nothing, never a device's routes", () => {
    const client = emit(readJson("api/openapi.json"));
    for (const name of ["getMe", "listSessions", "endSession", "setPhoto", "resolveInvite"]) {
      expect(client).toContain(`export function ${name}(`);
    }
    for (const name of ["registerDevice", "sendMessage", "openSocket", "setPushToken"]) {
      expect(client).not.toContain(`export function ${name}(`);
    }
    expect(forWeb({ security: [{ deviceToken: [] }, { session: [] }] })).toBe(true);
    expect(forWeb({ security: [{ deviceToken: [] }] })).toBe(false);
    expect(forWeb({ security: [] })).toBe(true);
    expect(forWeb({ operationId: "registerDevice", security: [] })).toBe(false);
    expect(forWeb({ security: [{ session: [] }], "x-ws-frames": {} })).toBe(false);
  });

  it("maps the schema keywords the spec uses", () => {
    const object = {
      type: "object",
      properties: {
        name: { type: ["string", "null"], description: "Shown" },
        kind: { type: "string", enum: ["a", "b"] },
        count: { type: "integer", minimum: 0 },
        "x-y": { type: "array", items: { $ref: "#/components/schemas/Thing" } },
        by: { allOf: [{ $ref: "#/components/schemas/Who" }, { description: "Who did it" }] },
      },
      required: ["name", "kind"],
    };
    expect(tsType(object, "T")).toBe(
      [
        "{",
        "  /** Shown */",
        "  name: string | null;",
        '  kind: "a" | "b";',
        "  count?: number;",
        '  "x-y"?: Array<Thing>;',
        "  /** Who did it */",
        "  by?: Who;",
        "}",
      ].join("\n"),
    );
    expect(tsType({ oneOf: [{ $ref: "#/components/schemas/A" }, { type: "null" }] }, "U")).toBe(
      "A | null",
    );
    expect(tsType({ anyOf: [{ $ref: "#/components/schemas/A" }, { type: "null" }] }, "N")).toBe(
      "A | null",
    );
  });

  it("declares a union of objects as a type, an object as an interface", () => {
    const one = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const either = { oneOf: [one, { $ref: "#/components/schemas/One" }] };
    const client = emit({ paths: {}, components: { schemas: { One: one, Either: either } } });
    expect(client).toContain("export interface One {");
    expect(client).toContain("export type Either = {\n  a: string;\n} | One;");
  });

  it("refuses a keyword it does not understand", () => {
    expect(() => tsType({ type: "object", additionalProperties: true }, "Loose")).toThrow(
      "Loose: unsupported additionalProperties",
    );
    expect(() =>
      emit(spec({ operationId: "x", parameters: [{ in: "header", name: "h" }] })),
    ).toThrow("x: unsupported parameter in header");
    expect(() => emit(spec({ responses: {} }))).toThrow(
      "get /v1/things/{thingId}: needs an operationId",
    );
  });
});
