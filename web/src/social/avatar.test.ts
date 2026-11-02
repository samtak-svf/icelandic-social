import { describe, expect, it } from "vitest";
import { coverKey, coverSrc } from "./avatar.tsx";

// The browser half (the fetch, the swap on screen) is e2e/; under Node this
// holds the rule Cover draws by: a cover belongs to one request, and a request
// that names another community or another version has nothing to show until
// its own answer comes. It is a rule of the render, not an effect, so the
// previous cover is gone in the same frame the inputs change.
describe("Cover", () => {
  const before = coverKey("cover", "c1", "v1", "expanded");
  const fetched = { request: before, url: "blob:one" } as const;

  it("shows the fetched cover while its own request is the one asked for", () => {
    expect(coverSrc(undefined, fetched, before)).toBe("blob:one");
  });

  it("shows nothing the moment the version changes, before the new cover comes", () => {
    const after = coverKey("cover", "c1", "v2", "expanded");
    expect(after).not.toBe(before);
    expect(coverSrc(undefined, fetched, after)).toBeNull();
  });

  it("shows nothing for another community, or another frame of the same one", () => {
    expect(coverSrc(undefined, fetched, coverKey("cover", "c2", "v1", "expanded"))).toBeNull();
    expect(coverSrc(undefined, fetched, coverKey("cover", "c1", "v1", "medium"))).toBeNull();
    expect(coverSrc(undefined, fetched, coverKey("wallCover", "c1", "v1", "expanded"))).toBeNull();
  });

  it("shows nothing once there is no version to show", () => {
    expect(coverSrc(undefined, fetched, null)).toBeNull();
  });

  it("prefers a cover held in the browser over any fetched one", () => {
    expect(coverSrc("blob:local", fetched, before)).toBe("blob:local");
    expect(coverSrc(null, fetched, before)).toBe("blob:one");
  });
});
