// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditThankastrik, thankastrikIn } from "../thankastrik.mjs";
import { tempDir } from "./helpers.mjs";

const EM = "—";
const EN = "–";

describe("thankastrik", () => {
  it("flags an em dash and a spaced en dash in Icelandic", () => {
    expect(thankastrikIn(`Á Íslandi ${EM} og hvergi annars staðar`)).toHaveLength(1);
    expect(thankastrikIn(`Mér líkaði vel við hann ${EN} oftast.`)).toHaveLength(1);
  });

  it("leaves a millistrik and English text alone", () => {
    expect(thankastrikIn(`Opið 9${EN}17 á virkum dögum`)).toEqual([]);
    expect(thankastrikIn(`Contrast pairs ${EM} shared by all brands`)).toEqual([]);
  });

  it("reports the JSON pointer of the offending brand string", () => {
    const root = tempDir("spjall-thankastrik-");
    mkdirSync(join(root, "brand/x"), { recursive: true });
    writeFileSync(
      join(root, "brand/x/strings.is.json"),
      JSON.stringify({ send: `Senda ${EM} núna` }),
    );
    const { problems, scanned } = auditThankastrik(["brand/x/strings.is.json", "README.md"], root);
    expect(scanned).toBe(1);
    expect(problems.map((p) => p.pointer)).toEqual(["/send"]);
  });
});
