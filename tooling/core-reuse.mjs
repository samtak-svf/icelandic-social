// @ts-check
// Build the core once (decision 0013, issue #36).
//
// A core PR builds both zips; the `core-vX.Y.Z` tag on the merged commit used
// to build them again from the same tree. Now the PR uploads each zip under a
// name derived from everything that decides its bytes, and the tag job reuses
// the zip of that name instead of building.
//
// The name covers:
// - the git trees of core/ and identifiers/ (core.yml triggers on both). The
//   core tree holds rust-toolchain.toml and artifact.lock.json, so the
//   toolchain and the NDK are in it;
// - the blob of .github/workflows/core.yml, so a changed build step never
//   reuses a zip built by the old one;
// - the platform, and for iOS the Xcode version, which the runner image picks.
// All of it is read from the commit, never the working tree.
//
// A zip is reused only from a run whose code came from this repository. A
// fork's PR run builds the fork's code, so its artifact is never picked,
// whatever it is named.
//
//   node tooling/core-reuse.mjs name <android|ios>
//     prints the artifact name for HEAD (iOS asks xcodebuild for the version)
//   gh api … /actions/artifacts?name=<name> | node tooling/core-reuse.mjs pick <name> <repoId>
//     prints the run id holding the newest usable artifact, or nothing

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOT, git } from "./lib/repo.mjs";

const PLATFORMS = ["android", "ios"];
const WORKFLOW = ".github/workflows/core.yml";

/**
 * @param {"android" | "ios"} platform
 * @param {{ root?: string, xcode?: string }} [options]
 * @returns {string} `core-<platform>-<40 hex>`
 */
export function artifactName(platform, { root = ROOT, xcode } = {}) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform ${platform}`);
  if (platform === "ios" && !xcode?.trim()) {
    throw new Error("an iOS name needs the Xcode version that builds it");
  }
  const parts = [
    `platform ${platform}`,
    `core ${rev(root, "HEAD:core")}`,
    `identifiers ${rev(root, "HEAD:identifiers")}`,
    `workflow ${rev(root, `HEAD:${WORKFLOW}`)}`,
  ];
  if (platform === "ios") parts.push(`xcode ${xcode?.trim()}`);
  const key = createHash("sha1").update(parts.join("\n")).digest("hex");
  return `core-${platform}-${key}`;
}

/**
 * @param {string} root
 * @param {string} spec
 */
function rev(root, spec) {
  return git(["rev-parse", "--verify", "--quiet", spec], root).trim();
}

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   expired: boolean,
 *   created_at: string,
 *   workflow_run?: { id: number, repository_id?: number, head_repository_id?: number },
 * }} Artifact
 */

/**
 * The newest artifact with exactly this name that is still downloadable and
 * was built from this repository's own code.
 *
 * @param {Artifact[]} artifacts
 * @param {string} name
 * @param {number} repoId
 * @returns {{ artifactId: number, runId: number } | null}
 */
export function pick(artifacts, name, repoId) {
  const usable = artifacts
    .filter((a) => a.name === name && !a.expired)
    .filter((a) => a.workflow_run?.head_repository_id === repoId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const found = usable[0];
  if (!found?.workflow_run) return null;
  return { artifactId: found.id, runId: found.workflow_run.id };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "name") {
    const platform = /** @type {"android" | "ios"} */ (args[0]);
    const xcode =
      platform === "ios"
        ? execFileSync("xcodebuild", ["-version"], { encoding: "utf8" })
        : undefined;
    console.log(artifactName(platform, { xcode }));
  } else if (command === "pick" && args[0] && args[1]) {
    const response = JSON.parse(readFileSync(0, "utf8"));
    const found = pick(response.artifacts ?? [], args[0], Number(args[1]));
    if (found) console.log(found.runId);
  } else {
    console.error("usage: core-reuse.mjs name <android|ios> | pick <name> <repoId>");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
