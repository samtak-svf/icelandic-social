// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

  it("calls the API with the path, query, body and client header it declares", async () => {
    // Imported by URL so the tooling's type check does not walk into web/.
    const api = await import(pathToFileURL(join(ROOT, OUTPUT)).href);
    const CLIENT = `web/${readJson("web/package.json").version}`;
    /** @type {Request[]} */
    const seen = [];
    /** @param {Response} answer */
    const fake = (answer) => ({
      /** @param {string} url @param {RequestInit} init */
      fetch: async (url, init) => {
        seen.push(new Request(new URL(url, "https://web.test"), init));
        return answer;
      },
    });
    const json = (/** @type {unknown} */ body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    const ended = await api.endSession(
      { path: { sessionId: "a/b c" } },
      fake(new Response(null, { status: 204 })),
    );
    expect(ended).toEqual({ status: 204, data: undefined });
    expect(seen[0]?.method).toBe("DELETE");
    expect(new URL(seen[0]?.url ?? "").pathname).toBe("/v1/sessions/a%2Fb%20c");
    expect(seen[0]?.headers.get("spjall-client")).toBe(CLIENT);
    expect(CLIENT).toMatch(/^web\/\d+\.\d+\.\d+$/);
    expect(seen[0]?.credentials).toBe("same-origin");

    const page = await api.listPeople(
      { query: { q: "jón", limit: 5 } },
      fake(json({ people: [] })),
    );
    expect(page).toEqual({ status: 200, data: { people: [] } });
    expect(new URL(seen[1]?.url ?? "").search).toBe("?q=j%C3%B3n&limit=5");

    const refused = await api.getMe(fake(json({ error: "unauthorized", requestId: "r" }, 401)));
    expect(refused).toEqual({ status: 401, data: { error: "unauthorized", requestId: "r" } });

    const photo = new Uint8Array([1, 2, 3]).buffer;
    await api.setPhoto({ body: photo }, fake(json({ photo: "v1" })));
    expect(seen[3]?.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await (seen[3] ?? new Request("x:")).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
