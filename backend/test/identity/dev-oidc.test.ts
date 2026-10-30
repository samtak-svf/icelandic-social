import { describe, expect, it } from "vitest";
import ids from "../../../identifiers/ids.json" with { type: "json" };
import { appRedirect, FAKE_PROVIDERS } from "../../dev/oidc.ts";

// A browser compiles an input's `pattern` with the v flag and ignores one that
// does not compile, so the fake sign-in form would check nothing.
it("each fake provider's login hint compiles as a browser compiles a pattern", () => {
  for (const { hint } of FAKE_PROVIDERS) {
    expect(() => new RegExp(`^(?:${hint.pattern})$`, "v")).not.toThrow();
  }
});

// A debug app beside a store install on one phone: the store app must never be
// handed a fake's code, and Google's redirect must not leave for the real host.
describe("appRedirect", () => {
  const debug = `${ids.store.urlScheme}.debug`;

  it("sends the fakes' redirects to the debug scheme once one is set", () => {
    expect(appRedirect(`https://${ids.hosts.link}/oauth/google?code=c&state=s`, debug)).toBe(
      `${debug}:/google?code=c&state=s`,
    );
    expect(appRedirect(`${ids.store.urlScheme}:/kenni?code=c`, debug)).toBe(
      `${debug}:/kenni?code=c`,
    );
  });

  it("leaves every redirect alone with no scheme set, and any other host always", () => {
    const google = `https://${ids.hosts.link}/oauth/google?code=c`;
    expect(appRedirect(google, null)).toBe(google);
    expect(appRedirect("https://example.test/back?code=c", debug)).toBe(
      "https://example.test/back?code=c",
    );
  });
});
