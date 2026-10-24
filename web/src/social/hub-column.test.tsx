import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { HubColumn } from "./hub-column.tsx";

// The rows are links, which need the router: they are checked in e2e/wide-hub.
// Under Node this holds what the column shows without any.
describe("HubColumn", () => {
  const noop = () => undefined;

  it("is hidden below expanded and sticky beside the feed from it", () => {
    const html = renderToStaticMarkup(<HubColumn mine={null} reloadMine={noop} verified={false} />);
    expect(html).toMatch(/class="hidden [^"]*expanded:sticky[^"]*expanded:flex/);
    expect(html).toContain(`>${strings.communities_mine}</h2>`);
    expect(html).toContain(strings.loading);
  });

  it("says so when the person is in no community", () => {
    const html = renderToStaticMarkup(
      <HubColumn
        mine={{ ok: true, data: { communities: [] } }}
        reloadMine={noop}
        verified={false}
      />,
    );
    expect(html).toContain(strings.communities_empty);
  });
});
