import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExportSummary } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { ExportProblem, ExportState } from "./screen.tsx";

// The sentences of the export screen. The bug each test names: a ready file with no way to
// take it or no date it goes, a failure with no reason, and a second ask refused in the
// app's general words instead of the one-a-day sentence.

const row = (over: Partial<ExportSummary> = {}): ExportSummary => ({
  exportId: "ex_1",
  state: "ready",
  failure: null,
  size: 10,
  createdAt: Date.parse("2026-11-01T12:00:00.000Z"),
  expiresAt: Date.parse("2026-11-08T12:00:00.000Z"),
  ...over,
});

const html = (element: React.ReactElement) =>
  renderToStaticMarkup(element).replaceAll("&#x27;", "'");

describe("an export's state", () => {
  it("offers the download of a ready file and says the day it goes", () => {
    const out = html(<ExportState row={row()} busy={false} onDownload={() => undefined} />);
    expect(out).toContain(strings.export_download);
    expect(out).toContain(strings.export_ready({ date: formatIsDate(row().expiresAt) }));
  });

  it("holds the download while a request runs", () => {
    expect(html(<ExportState row={row()} busy onDownload={() => undefined} />)).toContain(
      "disabled",
    );
  });

  it("says a building file is being built, with no download", () => {
    const out = html(
      <ExportState row={row({ state: "building" })} busy={false} onDownload={() => undefined} />,
    );
    expect(out).toContain(strings.export_building);
    expect(out).not.toContain(strings.export_download);
  });

  it("names the reason a file was too big, and a general failure otherwise", () => {
    const failed = (failure: string) =>
      html(
        <ExportState
          row={row({ state: "failed", failure })}
          busy={false}
          onDownload={() => undefined}
        />,
      );
    expect(failed("too_big")).toContain(strings.export_failed_too_big);
    expect(failed("stalled")).toContain(strings.export_failed);
  });
});

describe("an export's refusal", () => {
  it("is the one-a-day sentence for a conflict", () => {
    const problem = { kind: "refused", code: "conflict", requestId: null } as const;
    expect(html(<ExportProblem problem={problem} />)).toContain(strings.export_conflict);
  });
});
