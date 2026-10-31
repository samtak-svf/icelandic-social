// @ts-check
// A report note the client accepts and the server refuses loses what the person
// wrote. The server's limit reaches the contract, and each client writes its own
// copy by hand until limits are generated, so this holds the copies to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

/** @param {string} path relative to the repo */
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** @returns {number} the note's limit in the contract */
function contractLimit() {
  const paths = JSON.parse(read("api/openapi.json")).paths;
  const body = paths["/v1/reports"].post.requestBody.content["application/json"];
  return body.schema.properties.note.maxLength;
}

const CLIENTS = [
  {
    path: "android/app/src/main/kotlin/samtak/spjall/social/Content.kt",
    limit: /const val NOTE_LIMIT = ([\d_]+)/,
  },
  { path: "ios/App/Social/ReportModel.swift", limit: /static let noteLimit = ([\d_]+)/ },
  { path: "web/src/social/report.tsx", limit: /maxLength=\{([\d_]+)\}/ },
];

describe("the report note's limit", () => {
  it("is stated by the contract", () => {
    expect(contractLimit()).toBeGreaterThan(0);
  });

  it.each(CLIENTS)("in $path is the contract's", ({ path, limit }) => {
    const stated = limit.exec(read(path))?.[1];
    if (stated === undefined) throw new Error(`${path} no longer states the limit`);
    expect(Number(stated.replaceAll("_", ""))).toBe(contractLimit());
  });
});
