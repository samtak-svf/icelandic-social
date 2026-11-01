import { describe, expect, it } from "vitest";
import vectors from "../../../api/link.vectors.json" with { type: "json" };
import { communityAddress, postAddress } from "./own-address.ts";

describe("the address a person shares", () => {
  it("has vectors to read", () => {
    expect(vectors.minted.length).toBeGreaterThan(0);
  });
  for (const v of vectors.minted) {
    it(`${v.kind} ${v.id}`, () => {
      const origin = new URL(v.address).origin;
      const minted = v.kind === "post" ? postAddress(v.id, origin) : communityAddress(v.id, origin);
      expect(minted).toBe(v.address);
    });
  }
});
