import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Status } from "./kit.tsx";

describe("Button link tone", () => {
  const html = renderToStaticMarkup(<Button tone="link">x</Button>);
  it("keeps the 44px hit target and tight padding", () => {
    expect(html).toContain("min-h-11");
    expect(html).toContain("px-2");
    expect(html).not.toContain("px-4");
  });
  it("is borderless and backgroundless", () => {
    expect(html).not.toMatch(/\bborder/);
    expect(html).not.toMatch(/\bbg-/);
  });
  it("other tones keep their padding", () => {
    expect(renderToStaticMarkup(<Button>x</Button>)).toContain("px-4");
  });
});

describe("Status", () => {
  it("inline takes no minimum height but stays a live region", () => {
    const html = renderToStaticMarkup(<Status inline />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("min-h-6");
  });
});
