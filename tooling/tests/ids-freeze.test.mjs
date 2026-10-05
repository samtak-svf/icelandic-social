// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRange, checkTree, diffPointers } from "../ids-freeze.mjs";
import { copyRepo, editJson, git, initRepo } from "./helpers.mjs";

const IDS = "identifiers/ids.json";
const LOCK = "identifiers/ids.lock.json";

describe("ids-freeze, working tree", () => {
  it("passes on the repo as committed", () => {
    expect(checkTree()).toEqual([]);
  });

  it("fails when ids.json changes without the lock, naming the pointer", () => {
    const root = copyRepo(["identifiers"]);
    editJson(root, IDS, (ids) => {
      ids.cloudflare.worker = "spjall-api-v2";
    });
    const problems = checkTree(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("/cloudflare/worker");
  });

  it("fails on a reformatted lock even when the values agree", () => {
    const root = copyRepo(["identifiers"]);
    const minified = JSON.stringify(JSON.parse(readFileSync(join(root, LOCK), "utf8")));
    writeFileSync(join(root, LOCK), minified);
    expect(checkTree(root).join()).toContain("differs in formatting");
  });

  it("refuses a non-EU jurisdiction even when ids and lock agree", () => {
    const root = copyRepo(["identifiers"]);
    for (const file of [IDS, LOCK]) {
      editJson(root, file, (ids) => {
        ids.cloudflare.jurisdiction = "fedramp";
      });
    }
    expect(checkTree(root).join()).toContain("/cloudflare/jurisdiction");
  });

  it("refuses an unknown key", () => {
    const root = copyRepo(["identifiers"]);
    for (const file of [IDS, LOCK]) {
      editJson(root, file, (ids) => {
        ids.store.extra = "x";
      });
    }
    expect(checkTree(root).join()).toContain("(extra)");
  });
});

describe("ids-freeze, interim Apple ids (decision 0011)", () => {
  /** @param {(ids: any) => void} mutate */
  function interimProblems(mutate) {
    const root = copyRepo(["identifiers"]);
    for (const file of [IDS, LOCK]) editJson(root, file, mutate);
    return checkTree(root).join("\n");
  }

  it("refuses an interim id that is a frozen id", () => {
    const problems = interimProblems((ids) => {
      ids.appleInterim.iosBundleId = ids.store.iosBundleId;
      ids.appleInterim.iosNotificationServiceBundleId = ids.store.iosNotificationServiceBundleId;
    });
    expect(problems).toContain("/appleInterim/iosBundleId");
    expect(problems).toContain("/appleInterim/iosNotificationServiceBundleId");
  });

  it("refuses an interim App Group that is the frozen one", () => {
    expect(
      interimProblems((ids) => {
        ids.appleInterim.appGroup = ids.store.appGroup;
      }),
    ).toContain("/appleInterim/appGroup");
  });

  it("refuses an interim id that does not extend the frozen one", () => {
    expect(
      interimProblems((ids) => {
        ids.appleInterim.iosBundleId = "is.example.beta";
        ids.appleInterim.iosNotificationServiceBundleId = "is.example.beta.notifications";
      }),
    ).toContain("/appleInterim/iosBundleId");
  });

  it("refuses a notification service id outside its app id", () => {
    expect(
      interimProblems((ids) => {
        ids.appleInterim.iosNotificationServiceBundleId = `${ids.store.iosBundleId}.other`;
      }),
    ).toContain("/appleInterim/iosNotificationServiceBundleId");
  });

  it("refuses the interim team as the frozen team", () => {
    expect(
      interimProblems((ids) => {
        ids.services.appleTeamId = ids.appleInterim.teamId;
      }),
    ).toContain("/appleInterim/teamId");
  });

  it("accepts no interim at all", () => {
    expect(
      interimProblems((ids) => {
        ids.appleInterim = null;
      }),
    ).toBe("");
  });
});

describe("ids-freeze, history", () => {
  /** @param {(root: string) => void} change */
  function rangeAfter(change) {
    const root = copyRepo(["identifiers"]);
    initRepo(root);
    change(root);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "change"]);
    return checkRange("main~1", root);
  }

  const renameWorker = (/** @type {string} */ root) => {
    for (const file of [IDS, LOCK]) {
      editJson(root, file, (ids) => {
        ids.cloudflare.worker = "spjall-api-v2";
      });
    }
  };

  it("fails a lock change with no decision record", () => {
    expect(rangeAfter(renameWorker).join()).toContain("no record was added");
  });

  it("passes a lock change that adds a decision record", () => {
    const problems = rangeAfter((root) => {
      renameWorker(root);
      mkdirSync(join(root, "docs/decisions"), { recursive: true });
      writeFileSync(join(root, "docs/decisions/0009-rename-worker.md"), "# 0009\n");
    });
    expect(problems).toEqual([]);
  });

  it("passes a range that does not touch the lock", () => {
    expect(rangeAfter((root) => writeFileSync(join(root, "README.md"), "x\n"))).toEqual([]);
  });
});

describe("diffPointers", () => {
  it("lists every changed leaf", () => {
    expect(diffPointers({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3, d: 4 } })).toEqual([
      "/a/c",
      "/a/d",
    ]);
  });
});
