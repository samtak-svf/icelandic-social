// @ts-check
// The term table (decision 0117). Runs against the first committed brand and reads every word
// from its table, so renaming a term touches nothing here.
import { describe, expect, it } from "vitest";
import { checkBrand } from "../brand-check.mjs";
import { generate } from "../brand-gen.mjs";
import { checkTerms, expandStrings, expandText, tokensIn } from "../lib/brand-gen/terms.mjs";
import { brandNames, readJson } from "../lib/repo.mjs";
import { formsFrom } from "../terms-forms.mjs";
import { copyRepo, editJson } from "./helpers.mjs";

const BRAND = brandNames()[0] ?? "";
const STRINGS = `brand/${BRAND}/strings.is.json`;
const TERMS = `brand/${BRAND}/terms.is.json`;
const table = readJson(TERMS);
const ids = Object.keys(table.terms);
const firstId = ids[0] ?? "";
const first = table.terms[firstId];

/** @param {(root: string) => void} change */
function problemsAfter(change) {
  const root = copyRepo(["brand"]);
  change(root);
  return checkBrand(BRAND, root).problems.join("\n");
}

/** @param {string} text */
function withSend(text) {
  return problemsAfter((root) =>
    editJson(root, STRINGS, (s) => {
      s.send = text;
    }),
  );
}

const fixture = {
  terms: {
    thing: {
      forms: { acc: "hlut", "nom.pl": "hlutir" },
      agreement: { "it.nom": "hann" },
    },
  },
};

describe("expansion", () => {
  it("replaces a token with its slot, next to a placeholder", () => {
    expect(expandText("Stofna [[thing.acc]] {name}", fixture)).toBe("Stofna hlut {name}");
  });

  it("capitalises when the term id is capitalised", () => {
    expect(expandText("[[Thing.nom.pl]]. [[Thing.it.nom]] fer.", fixture)).toBe(
      "Hlutir. Hann fer.",
    );
  });

  it("expands plural values and leaves `$` keys alone", () => {
    expect(
      expandStrings(
        { $comment: "[[thing.acc]]", a: "[[thing.acc]]", b: { one: "[[thing.acc]]", other: "x" } },
        fixture,
      ),
    ).toEqual({ $comment: "[[thing.acc]]", a: "hlut", b: { one: "hlut", other: "x" } });
  });

  it("finds a token in generated text, and does not take code for one", () => {
    expect(tokensIn("a [[thing.acc]] b")).toEqual(["[[thing.acc]]"]);
    expect(tokensIn("let m = [[1, 2], [3]]; x[[y]]")).toEqual([]);
  });
});

describe("the gate", () => {
  it("passes the committed brand", () => {
    expect(checkBrand(BRAND).problems).toEqual([]);
  });

  it("fails an unknown term and an unknown slot", () => {
    expect(withSend("[[nosuchterm.acc]]")).toContain('unknown term "nosuchterm"');
    expect(withSend(`[[${firstId}.nosuchslot]]`)).toContain('no slot "nosuchslot"');
  });

  it("fails a token it cannot read", () => {
    expect(withSend(`[[${firstId}]]`)).toContain("malformed token");
    expect(withSend(`[[ ${firstId}.acc ]]`)).toContain("malformed token");
  });

  it("fails a raw form of a term's noun, in any case and in any form", () => {
    // Against the check itself: a copy of brand/ per form takes longer than a test may.
    /** @param {string} send */
    const gate = (send) => checkTerms(table, { send }).join("\n");
    for (const id of ids) {
      for (const form of Object.values(table.terms[id].forms)) {
        const text = /** @type {string} */ (form);
        expect(gate(`Senda ${text}`)).toContain(`term "${id}"`);
        expect(gate(`${text.toUpperCase()} senda`)).toContain(`term "${id}"`);
      }
    }
  });

  it("names the longer term when one noun is inside another", () => {
    const [longest] = ids
      .map((id) => ({ id, form: String(table.terms[id].forms.nom) }))
      .sort((a, b) => b.form.length - a.form.length);
    expect(withSend(`Senda ${longest?.form}`)).toContain(`term "${longest?.id}"`);
  });

  it("fails a word built on a noun unless the compound is declared", () => {
    const form = first.forms.acc;
    expect(withSend(`Senda aukaorð${form}`)).toContain(`term "${firstId}"`);
    const declared = table.compounds[0].word;
    expect(withSend(`Senda ${declared}`)).not.toContain("term");
  });

  it("fails a compound nobody uses", () => {
    const problems = problemsAfter((root) =>
      editJson(root, TERMS, (t) => {
        t.compounds.push({ word: "ónotað", reason: "test" });
      }),
    );
    expect(problems).toContain('compound "ónotað" is in no string');
  });

  it("fails every form of a retired word", () => {
    expect(table.retired[0].forms.length).toBeGreaterThan(5);
    for (const form of table.retired[0].forms) {
      expect(withSend(`Senda ${form}`)).toContain(`retired "${table.retired[0].headword}"`);
    }
  });

  it("fails a table that lacks a slot, a form or the schema's shape", () => {
    const problems = problemsAfter((root) =>
      editJson(root, TERMS, (t) => {
        delete t.terms[firstId].forms["gen.pl.def"];
      }),
    );
    expect(problems).toContain("terms.is.json");
    expect(problems).toContain("gen.pl.def");
  });

  it("treats a token as unknown in a brand with no table", () => {
    const root = copyRepo(["brand"]);
    editJson(root, TERMS, (t) => {
      t.terms = {};
      t.compounds = [];
      t.retired = [];
    });
    expect(checkBrand(BRAND, root).problems.join("\n")).toContain("unknown term");
  });
});

describe("generation", () => {
  it("leaves no token in any generated file", () => {
    const { problems, files } = generate(BRAND);
    expect(problems).toEqual([]);
    const text = files.filter((f) => typeof f.content === "string");
    expect(text.length).toBeGreaterThan(5);
    for (const file of text) expect(tokensIn(String(file.content))).toEqual([]);
  });

  it("refuses to generate when a token reaches an output", () => {
    const root = copyRepo(["brand", "identifiers"]);
    const token = `[[${firstId}.nom]]`;
    editJson(root, `brand/${BRAND}/brand.json`, (m) => {
      m.displayName = token;
    });
    editJson(root, STRINGS, (s) => {
      s.app_name = token;
    });
    const { problems, files } = generate(BRAND, root);
    expect(files).toEqual([]);
    expect(problems.join("\n")).toContain("a token reached");
  });
});

describe("terms-forms", () => {
  const entries = [
    {
      ord: "hlutur",
      ofl: "no",
      kyn: "kk",
      guid: "abc",
      bmyndir: [
        { g: "NFET", b: "hlutur" },
        { g: "NFETgr", b: "hluturinn" },
        { g: "ÞGFET", b: "hlut" },
        { g: "ÞGFET2", b: "hluti" },
        { g: "ÞGFFTgr", b: "hlutunum" },
      ],
    },
    { ord: "annað", ofl: "no", kyn: "hk", guid: "zzz", bmyndir: [{ g: "NFET", b: "annað" }] },
  ];

  it("maps BÍN's tags to slots and sets a second form aside as a variant", () => {
    expect(formsFrom(entries, "hlutur")).toEqual({
      bin: { headword: "hlutur", guid: "abc" },
      gender: "kk",
      forms: { nom: "hlutur", "nom.def": "hluturinn", dat: "hlut", "dat.pl.def": "hlutunum" },
      variants: { dat: "hluti" },
    });
  });

  it("builds a compound with no headword from its last part", () => {
    const out = formsFrom(entries, "hlutur", "auka");
    expect(out.bin).toEqual({ headword: "hlutur", guid: "abc", prefix: "auka" });
    expect(out.forms.nom).toBe("aukahlutur");
    expect(out.variants.dat).toBe("aukahluti");
  });

  it("fails when BÍN has no such noun", () => {
    expect(() => formsFrom({ 0: "" }, "hlutur")).toThrow("no noun");
    expect(() => formsFrom(entries, "enginnslikur")).toThrow("no noun");
  });
});
