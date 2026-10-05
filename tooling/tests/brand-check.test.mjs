// @ts-check
import { describe, expect, it } from "vitest";
import { checkBrand, CLAIMS } from "../brand-check.mjs";
import { colorTokens, measure } from "../lib/contrast.mjs";
import { brandNames, readJson } from "../lib/repo.mjs";
import { copyRepo, editJson } from "./helpers.mjs";

// Runs against the first committed brand, whichever it is: the tests describe
// the check, not one brand's copy.
const BRAND = brandNames()[0] ?? "";
const STRINGS = `brand/${BRAND}/strings.is.json`;

/** @param {(root: string) => void} change */
function problemsAfter(change) {
  const root = copyRepo(["brand"]);
  change(root);
  return checkBrand(BRAND, root).problems;
}

describe("brand-check", () => {
  it("passes every committed brand", () => {
    expect(checkBrand(BRAND).problems).toEqual([]);
  });

  it("fails when a brand drops a key", () => {
    const problems = problemsAfter((root) =>
      editJson(root, STRINGS, (s) => {
        delete s.send;
      }),
    );
    expect(problems).toContain("strings.is.json send: missing");
  });

  it("fails on a key the contract does not declare", () => {
    const problems = problemsAfter((root) =>
      editJson(root, STRINGS, (s) => {
        s.surprise = "Óvænt";
      }),
    );
    expect(problems.join()).toContain("surprise: not in strings.contract.json");
  });

  it("fails when a placeholder is missing or extra", () => {
    const problems = problemsAfter((root) =>
      editJson(root, STRINGS, (s) => {
        s.new_device_card = "Nýtt tæki.";
        s.send = "Senda {name}";
      }),
    );
    expect(problems.join("\n")).toMatch(/new_device_card: placeholders \{\}/);
    expect(problems.join("\n")).toMatch(/send: placeholders \{name\}/);
  });

  it("fails a plural without both Icelandic categories", () => {
    const problems = problemsAfter((root) =>
      editJson(root, STRINGS, (s) => {
        s.unread_count = { other: "{count} ólesin" };
      }),
    );
    expect(problems.join()).toContain("unread_count: plural categories");
  });

  it("fails a reworded residency claim", () => {
    const problems = problemsAfter((root) =>
      editJson(root, STRINGS, (s) => {
        s.residency_claim = "Gögnin eru geymd á Íslandi.";
      }),
    );
    expect(problems.join()).toContain(CLAIMS.residency);
  });

  it("fails when displayName and app_name disagree", () => {
    const problems = problemsAfter((root) =>
      editJson(root, `brand/${BRAND}/brand.json`, (b) => {
        b.displayName = "Annað";
      }),
    );
    expect(problems.join()).toContain("differs from strings app_name");
  });

  it("fails a brand whose primary no longer carries white text at AA", () => {
    const problems = problemsAfter((root) =>
      editJson(root, `brand/${BRAND}/tokens.json`, (t) => {
        t.color.primary.$value.components = [0.7, 0.19, 32];
      }),
    );
    expect(problems.join("\n")).toMatch(/contrast primary-fg on primary: .* below 4\.5:1/);
  });

  it("fails a brand.json that the schema rejects", () => {
    const problems = problemsAfter((root) =>
      editJson(root, `brand/${BRAND}/brand.json`, (b) => {
        b.aliasHosts = ["not a host"];
      }),
    );
    expect(problems.join()).toContain("brand.json /aliasHosts/0");
  });
});

describe("contrast", () => {
  it("gives the WCAG endpoints and the ratio samtak-vefur measured for #b31800", () => {
    const tokens = new Map();
    expect(measure("black", "white", tokens).ratio).toBe(21);
    expect(measure("white", "white", tokens).ratio).toBe(1);
    expect(measure("white", "#b31800", tokens).ratio).toBe(6.89);
  });

  it("refuses a translucent colour with nothing under it", () => {
    const tokens = colorTokens(readJson(`brand/${BRAND}/tokens.json`));
    expect(() => measure("border-strong", "surface", tokens)).toThrow(/opaque/);
  });
});
