import { describe, expect, it } from "vitest";
import { tokenHash } from "../../src/identity/accounts.ts";
import { randomHex, toHex } from "../../src/shared/bytes.ts";

// Stored hashes and ids are this text, so a change here orphans what is stored.
describe("toHex", () => {
  it("writes two lower-case digits a byte", () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 171, 255]))).toBe("00010f10abff");
    expect(toHex(new Uint8Array())).toBe("");
  });

  it("keeps the token hash stored for a known token", async () => {
    expect(await tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("randomHex", () => {
  it("is two digits a byte", () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});
