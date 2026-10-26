import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deviceIcon } from "./device-icon.tsx";

// The Settings list draws a globe for a browser and a phone for a phone (2026-10-26: every row was alike).
describe("deviceIcon", () => {
  it("is a globe for a browser", () => {
    const html = renderToStaticMarkup(deviceIcon("web"));
    expect(html).toContain('data-icon="globe"');
    expect(html).not.toContain('data-icon="phone"');
  });

  it.each(["android", "ios"] as const)("is a phone for %s", (kind) => {
    const html = renderToStaticMarkup(deviceIcon(kind));
    expect(html).toContain('data-icon="phone"');
    expect(html).not.toContain('data-icon="globe"');
  });
});
