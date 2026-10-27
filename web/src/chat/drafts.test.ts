import { afterEach, describe, expect, it } from "vitest";
import { clearDrafts, draftOf, keepDraft } from "./drafts.ts";

afterEach(clearDrafts);

describe("drafts", () => {
  it("keeps each conversation's unsent text apart", () => {
    keepDraft("c1", "Hálfskrifað");
    keepDraft("c2", "Annað");
    expect(draftOf("c1")).toBe("Hálfskrifað");
    expect(draftOf("c2")).toBe("Annað");
    expect(draftOf("c3")).toBe("");
  });

  it("forgets a blank or sent draft", () => {
    keepDraft("c1", "Hæ");
    keepDraft("c1", "   ");
    expect(draftOf("c1")).toBe("");
    keepDraft("c1", "Hæ");
    keepDraft("c1", "");
    expect(draftOf("c1")).toBe("");
  });

  it("goes with signing out", () => {
    keepDraft("c1", "Hæ");
    clearDrafts();
    expect(draftOf("c1")).toBe("");
  });
});
