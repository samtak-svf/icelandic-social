import { describe, expect, it } from "vitest";
import { append } from "./paged.ts";

const id = (n: { id: string }) => n.id;
const item = (name: string) => ({ id: name });

describe("append", () => {
  it("adds the page after the pages held and takes its cursor", () => {
    const held = { items: [item("a"), item("b")], next: "c1" };
    expect(append(held, { items: [item("c")], next: "c2" }, id)).toEqual({
      items: [item("a"), item("b"), item("c")],
      next: "c2",
    });
  });

  it("keeps an item that arrives twice once, in its first place", () => {
    const held = { items: [item("a"), item("b")], next: "c1" };
    expect(append(held, { items: [item("b"), item("c")], next: null }, id).items).toEqual([
      item("a"),
      item("b"),
      item("c"),
    ]);
  });

  it("ends the list when the cursor is null, even for an empty page", () => {
    const held = { items: [item("a")], next: "c1" };
    expect(append(held, { items: [], next: null }, id)).toEqual({ items: [item("a")], next: null });
  });
});
