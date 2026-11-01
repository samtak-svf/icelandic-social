// @ts-check
// The association file hands /communities/<x> and /posts/<x> to the apps. A page of
// the web at such an address, one that is no id, has to be excluded there, or the app
// claims it and opens no screen (decision 0121). The core's own test holds the parser
// to the same pages; this holds the file the phone reads.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

const PARENTS = ["communities", "posts"];

/**
 * The fixed addresses a flat route file stands for: `communities.new.tsx` is
 * /communities/new, while an id, the index and a pathless layout name no fixed page.
 * @param {string[]} files route files relative to web/src/routes
 * @returns {string[]}
 */
function fixedAddresses(files) {
  const found = files.flatMap((file) => {
    if (!file.endsWith(".tsx")) return [];
    const [parent, ...rest] = file
      .slice(0, -".tsx".length)
      .split(/[./]/)
      .filter((segment) => !segment.startsWith("_"));
    const child = rest[0];
    if (parent === undefined || !PARENTS.includes(parent) || child === undefined) return [];
    return child.startsWith("$") || child === "index" ? [] : [`/${parent}/${child}`];
  });
  return [...new Set(found)];
}

/**
 * @param {string} source link.ts
 * @returns {string[]} the addresses it excludes by name, wildcards left out
 */
function excludedAddresses(source) {
  return [...source.matchAll(/\{ "\/": "([^"*]+)", exclude: true \}/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/**
 * @param {string[]} files
 * @param {string} source
 * @returns {string[]} the fixed pages the association file would hand to the apps
 */
function claimedByAccident(files, source) {
  const excluded = excludedAddresses(source);
  return fixedAddresses(files).filter((address) => !excluded.includes(address));
}

const source = readFileSync(join(ROOT, "backend/src/identity/link.ts"), "utf8");
const routes = readdirSync(join(ROOT, "web/src/routes"), { recursive: true, encoding: "utf8" });

describe("the addresses the apps claim", () => {
  it("excludes every fixed page of the web", () => {
    expect(fixedAddresses(routes)).toContain("/communities/new");
    expect(excludedAddresses(source)).toContain("/communities/new");
    expect(claimedByAccident(routes, source)).toEqual([]);
  });

  it("names a new page under either parent that is not excluded", () => {
    const added = ["communities.archive.tsx", "posts.drafts.tsx", "posts/saved.tsx"];
    expect(claimedByAccident([...routes, ...added], source)).toEqual([
      "/communities/archive",
      "/posts/drafts",
      "/posts/saved",
    ]);
  });

  it("reads no fixed page in an id, the index, a layout or a deeper page of an id", () => {
    const files = [
      "communities.$communityId.log.tsx",
      "communities.$communityId._tabs.tsx",
      "communities.index.tsx",
      "communities.tsx",
      "posts.$postId.tsx",
      "people.new.tsx",
      "communities.new.css",
    ];
    expect(fixedAddresses(files)).toEqual([]);
  });

  it("reads a page behind a pathless layout at its own address", () => {
    expect(fixedAddresses(["communities._hub.archive.tsx"])).toEqual(["/communities/archive"]);
  });
});
