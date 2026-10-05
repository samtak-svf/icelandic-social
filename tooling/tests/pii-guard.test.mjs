// @ts-check
// Sample numbers are assembled at runtime so this file holds no kennitala or
// phone number the guard itself would report.
import { describe, expect, it } from "vitest";
import { classifyKennitala, findInText } from "../pii-guard.mjs";

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

/**
 * A structurally valid kennitala for a date of birth in 2099 (century digit 0),
 * so it belongs to nobody: no one is born yet on that date.
 *
 * @param {number} dayOffset 0 for a person, 40 for a company
 */
function future(dayOffset) {
  for (let serial = 20; serial < 100; serial += 1) {
    const head = `${String(1 + dayOffset).padStart(2, "0")}0199${serial}`;
    const rest = [...head].reduce((sum, d, i) => sum + Number(d) * (WEIGHTS[i] ?? 0), 0) % 11;
    if (rest !== 1) return `${head}${rest === 0 ? 0 : 11 - rest}0`;
  }
  throw new Error("no serial gives a check digit");
}

const PERSON = future(0);
const COMPANY = future(40);

describe("pii-guard", () => {
  it("tests with a kennitala whose date of birth has not come yet", () => {
    const born = new Date(
      Date.UTC(
        2000 + Number(PERSON.slice(4, 6)),
        Number(PERSON.slice(2, 4)) - 1,
        Number(PERSON.slice(0, 2)),
      ),
    );
    expect(PERSON.at(-1)).toBe("0");
    expect(born.getTime()).toBeGreaterThan(Date.now());
  });

  it("classifies a person's and a company's kennitala", () => {
    expect(classifyKennitala(PERSON)).toEqual({ valid: true, kind: "person" });
    expect(classifyKennitala(COMPANY).kind).toBe("company");
  });

  it("rejects a bad check digit", () => {
    const wrong = (Number(PERSON[8]) + 1) % 10;
    expect(classifyKennitala(`${PERSON.slice(0, 8)}${wrong}${PERSON[9]}`).valid).toBe(false);
  });

  it("finds a person's kennitala with or without a hyphen, redacted", () => {
    const text = `a ${PERSON}\nb ${PERSON.slice(0, 6)}-${PERSON.slice(6)}`;
    const findings = findInText("x.md", text);
    expect(findings.map((f) => f.line)).toEqual([1, 2]);
    expect(findings[0]?.match).not.toContain(PERSON.slice(4));
  });

  it("ignores a company kennitala and a ten-digit timestamp", () => {
    expect(findInText("x.md", `${COMPANY} 2026100512`)).toEqual([]);
  });

  it("finds an Icelandic phone number with its country code", () => {
    const phone = ["+354", "555", "1234"].join(" ");
    expect(findInText("x.md", `call ${phone}`).map((f) => f.kind)).toEqual(["phone"]);
  });
});
