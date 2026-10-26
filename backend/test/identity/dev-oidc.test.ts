import { expect, it } from "vitest";
import { FAKE_PROVIDERS } from "../../dev/oidc.ts";

// A browser compiles an input's `pattern` with the v flag and ignores one that
// does not compile, so the fake sign-in form would check nothing.
it("each fake provider's login hint compiles as a browser compiles a pattern", () => {
  for (const { hint } of FAKE_PROVIDERS) {
    expect(() => new RegExp(`^(?:${hint.pattern})$`, "v")).not.toThrow();
  }
});
