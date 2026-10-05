// @ts-check
// Sample numbers are assembled at runtime so this file holds no kennitala or
// phone number the guard itself would report.
import { describe, expect, it } from "vitest";
import { classifyKennitala, findInText } from "../pii-guard.mjs";

// Structurally valid, belongs to nobody (samtak-vefur's crypto test value).
const PERSON = ["010180", "3339"].join("");
const COMPANY = ["410180", "3329"].join("");

describe("pii-guard", () => {
  it("classifies a person's and a company's kennitala", () => {
    expect(classifyKennitala(PERSON)).toEqual({ valid: true, kind: "person" });
    expect(classifyKennitala(COMPANY).kind).toBe("company");
  });

  it("rejects a bad check digit", () => {
    expect(classifyKennitala(`${PERSON.slice(0, 8)}49`).valid).toBe(false);
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
