import { describe as group, expect, it } from "vitest";
import { strings } from "./generated/brand/strings.ts";
import { describe, refused } from "./problem.ts";

group("a refusal", () => {
  it("is named in the person's words when its code is one they can act on", () => {
    for (const [error, message] of [
      ["not_permitted", strings.problem_not_permitted],
      ["not_found", strings.problem_not_found],
      ["join_declined", strings.problem_join_declined],
      ["pin_limit", strings.post_pin_full],
      ["poll_closed", strings.poll_closed_problem],
      ["anonymous_off", strings.problem_anonymous_off],
      ["suspended", strings.problem_suspended],
    ] as const) {
      expect(describe(refused({ error, requestId: "r1" }))).toEqual({ message, requestId: null });
    }
  });

  it("is the generic sentence with its request id otherwise", () => {
    expect(describe(refused({ error: "internal_error", requestId: "r2" }))).toEqual({
      message: strings.error_generic,
      requestId: "r2",
    });
    expect(describe(refused("Bad Gateway"))).toEqual({
      message: strings.error_generic,
      requestId: null,
    });
  });

  it("is told apart from an unreachable server", () => {
    expect(describe({ kind: "unreachable" }).message).toBe(strings.error_unreachable);
  });
});
