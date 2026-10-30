import { describe, expect, it } from "vitest";
import type { Me } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDateTime } from "../lib/is-format.ts";
import { standing, suspendedText } from "./suspended.tsx";

const me = (suspension: Me["suspension"]): Me => ({
  accountId: "a1",
  name: "Sigrún",
  verified: true,
  photo: null,
  suspension,
  platformModerator: false,
  devices: [],
});

describe("a suspended account", () => {
  it("has none standing without one, and none once its end has passed", () => {
    expect(standing(me(null), 100)).toBeNull();
    expect(standing(me({ until: 100 }), 100)).toBeNull();
  });

  it("has one standing while it runs, and one with no end always", () => {
    expect(standing(me({ until: 101 }), 100)).toEqual({ until: 101 });
    expect(standing(me({ until: null }), 100)).toEqual({ until: null });
  });

  it("is told the end date when there is one", () => {
    expect(suspendedText(null)).toBe(strings.suspended_notice);
    const until = Date.UTC(2026, 10, 3, 12);
    expect(suspendedText(until)).toBe(
      strings.suspended_notice_until({ date: formatIsDateTime(until) }),
    );
  });
});
