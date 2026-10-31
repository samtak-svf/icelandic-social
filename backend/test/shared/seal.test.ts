import { describe, expect, it } from "vitest";
import { seal, unseal } from "../../src/shared/seal.ts";

// The bug each test names: a value readable without the key, a value sealed for one
// purpose opening for another, or a tampered value opening at all.
describe("seal", () => {
  const value = { token: "the-value" };

  it("opens what it sealed, and shows nothing of it", async () => {
    const sealed = await seal("key", "purpose", value);
    expect(sealed).not.toContain("the-value");
    expect(atob(sealed.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")).not.toContain(
      "the-value",
    );
    expect(await unseal("key", "purpose", sealed)).toEqual(value);
  });

  it("does not repeat itself for the same value", async () => {
    expect(await seal("key", "purpose", value)).not.toBe(await seal("key", "purpose", value));
  });

  it("refuses another key, another purpose, a changed value and nonsense", async () => {
    const sealed = await seal("key", "purpose", value);
    expect(await unseal("other", "purpose", sealed)).toBeNull();
    expect(await unseal("key", "other", sealed)).toBeNull();
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(await unseal("key", "purpose", flipped)).toBeNull();
    expect(await unseal("key", "purpose", "nonsense")).toBeNull();
    expect(await unseal("key", "purpose", "")).toBeNull();
  });
});
