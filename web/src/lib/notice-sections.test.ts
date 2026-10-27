import { describe, expect, it } from "vitest";
import { noticeSections } from "./notice-sections.ts";

const row = (id: string, createdAt: number) => ({ notificationId: id, createdAt });

describe("noticeSections", () => {
  it("splits at the time the list was last seen, newest first", () => {
    const got = noticeSections([row("a", 30), row("b", 20), row("c", 10)], 20);
    expect(got.fresh.map((n) => n.notificationId)).toEqual(["a"]);
    expect(got.earlier.map((n) => n.notificationId)).toEqual(["b", "c"]);
  });

  it("calls everything new when the list was never seen", () => {
    const got = noticeSections([row("a", 30), row("b", 20)], null);
    expect(got.fresh).toHaveLength(2);
    expect(got.earlier).toHaveLength(0);
  });

  it("leaves a section empty when nothing falls in it", () => {
    const got = noticeSections([row("a", 5)], 10);
    expect(got.fresh).toHaveLength(0);
    expect(got.earlier).toHaveLength(1);
  });
});
