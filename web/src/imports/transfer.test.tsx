import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TransferGrant, TransferRequest } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ConsentState, ConsentView } from "./transfer-consent.tsx";
import { TransferRow } from "./transfer-section.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

// A direct transfer on the web (decision 0129): the grant row and the consent screen. The
// bug each test names: a held count or a link to nothing shown, a scope missing from what
// the person consents to, or an expired request shown as a general failure.

const DAY = Date.parse("2020-03-04T12:00:00.000Z");

const grant = (over: Partial<TransferGrant> = {}): TransferGrant => ({
  grantId: "tg_1",
  clientName: "Exporter",
  scopes: ["social-posts", "media"],
  createdAt: DAY,
  importId: "imp_1",
  posts: 3,
  held: 2,
  leftBehind: 0,
  lastItemAt: DAY,
  ...over,
});

const request: TransferRequest = { clientName: "Exporter", scopes: ["social-posts", "media"] };

describe("TransferRow", () => {
  it("shows what came in, what waits, and a way to review it", () => {
    const html = renderToStaticMarkup(<TransferRow grant={grant()} revoke={() => undefined} />);
    expect(html).toContain("Exporter");
    expect(html).toContain(strings.imports_sync_posts({ count: 3 }));
    expect(html).toContain(strings.transfer_held({ count: 2 }));
    expect(html).toContain(strings.imports_preview_link);
    expect(html).toContain(strings.transfer_revoke);
    expect(html).not.toContain(strings.transfer_left_behind({ count: 0 }));
  });

  it("offers nothing to review when nothing is held, and counts what stayed behind", () => {
    const html = renderToStaticMarkup(
      <TransferRow
        grant={grant({ held: 0, leftBehind: 4, lastItemAt: null })}
        revoke={() => undefined}
      />,
    );
    expect(html).not.toContain(strings.imports_preview_link);
    expect(html).toContain(strings.transfer_left_behind({ count: 4 }));
    expect(html).not.toContain(strings.transfer_last({ date: "" }).split(" ")[0] ?? "");
  });
});

describe("ConsentView", () => {
  it("names the exporter and every scope it asks for", () => {
    const html = renderToStaticMarkup(<ConsentView request={request} answer={() => undefined} />);
    expect(html).toContain(strings.transfer_consent_title({ client: "Exporter" }));
    expect(html).toContain(strings.transfer_scope_social);
    expect(html).toContain(strings.transfer_scope_media);
    expect(html).toContain(strings.transfer_allow);
    expect(html).toContain(strings.transfer_deny);
  });

  it("says an expired request is gone, not that something broke", () => {
    const html = renderToStaticMarkup(
      <ConsentState
        loaded={{
          ok: false,
          status: 404,
          problem: { kind: "refused", code: "not_found", requestId: null },
        }}
      >
        {() => <p>never</p>}
      </ConsentState>,
    );
    expect(html).toContain(strings.transfer_consent_gone);
    expect(html).not.toContain("never");
  });
});
