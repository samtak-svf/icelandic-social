import { describe, expect, it } from "vitest";
import { verbs } from "./verbs.ts";

describe("the verbs a report offers", () => {
  it("follow the content's state", () => {
    const at = (targetState: "visible" | "hidden" | "removed" | "gone") =>
      verbs({ targetState, targetStanding: "gone" });
    expect(at("visible")).toMatchObject({ hide: true, remove: true, restore: false });
    expect(at("hidden")).toMatchObject({ hide: false, remove: true, restore: true });
    expect(at("removed")).toMatchObject({ hide: false, remove: false, restore: true });
    expect(at("gone")).toMatchObject({ hide: false, remove: false, restore: false });
  });

  it("follow the member's standing, and none for an owner or moderator", () => {
    const as = (targetStanding: Parameters<typeof verbs>[0]["targetStanding"]) =>
      verbs({ targetState: "gone", targetStanding });
    expect(as("member")).toMatchObject({ mute: true, unmute: false, ban: true, unban: false });
    expect(as("muted")).toMatchObject({ mute: false, unmute: true, ban: true, unban: false });
    expect(as("banned")).toMatchObject({ mute: false, unmute: false, ban: false, unban: true });
    expect(as("not_member")).toMatchObject({ mute: false, ban: true, unban: false });
    for (const standing of ["owner", "moderator", "gone"] as const) {
      expect(Object.values(as(standing)).some(Boolean)).toBe(false);
    }
  });

  it("are all offered when the server does not say", () => {
    expect(Object.values(verbs({ targetState: null, targetStanding: null })).every(Boolean)).toBe(
      true,
    );
  });
});
