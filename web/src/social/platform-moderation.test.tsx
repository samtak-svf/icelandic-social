import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ModerationLogEntry, Report } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Paged } from "./paged.ts";
import { LogEntries } from "./moderation-log.tsx";
import { act, actionsFor, dismiss, without, type Calls } from "./platform-moderation.ts";
import { PlatformView, QueueList } from "./platform-moderation.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

// Under Node there is no DOM: what is drawn is server-rendered from props, and
// what is done is a function with its calls passed in. The browser is e2e/.
const person = (photo: string | null) => ({
  accountId: "acc1",
  name: "Reikningur Eitt",
  verified: false,
  photo,
  role: null,
});

const report = (over: Partial<Report> = {}): Report => ({
  reportId: "rep1",
  communityId: null,
  target: { kind: "account", id: "acc1" },
  targetAccount: person("v1"),
  reason: "harassment",
  note: "Óviðeigandi mynd",
  state: "open",
  createdAt: 1_700_000_000_000,
  closedAt: null,
  decision: null,
  resolution: null,
  closedBy: null,
  targetAnonymous: false,
  targetStanding: null,
  targetState: null,
  targetMedia: [],
  ...over,
});

const entry: ModerationLogEntry = {
  entryId: 7,
  communityId: null,
  actor: person(null),
  asPlatform: true,
  action: "clear_account_photo",
  target: { kind: "account", id: "acc1" },
  targetAccount: person(null),
  reason: "Ástæða aðgerðar",
  createdAt: 1_700_000_100_000,
};

const noCalls = (): Calls => ({
  moderate: vi.fn(() => Promise.resolve({ status: 204 as const, data: undefined })),
  moderatePlatform: vi.fn(() => Promise.resolve({ status: 204 as const, data: undefined })),
  closeReport: vi.fn(() => Promise.resolve({ status: 204 as const, data: undefined })),
});

const paged = <T,>(over: Partial<Paged<T>>): Paged<T> => ({
  items: null,
  problem: null,
  hasMore: false,
  sentinel: () => undefined,
  reload: () => undefined,
  ...over,
});

describe("the platform queue", () => {
  it("renders a report with why, what the moderator may do, and the dismissal", () => {
    const html = renderToStaticMarkup(
      <QueueList reports={[report()]} calls={noCalls()} dealt={() => undefined} />,
    );
    expect(html).toContain(strings.report_reason_harassment);
    expect(html).toContain("Óviðeigandi mynd");
    expect(html).toContain("Reikningur Eitt");
    expect(html).toContain(strings.platform_clear_photo);
    expect(html).toContain(strings.moderation_dismiss);
  });

  it("says so when nothing waits", () => {
    const html = renderToStaticMarkup(
      <QueueList reports={[]} calls={noCalls()} dealt={() => undefined} />,
    );
    expect(html).toContain(strings.moderation_queue_empty);
  });

  it("offers the photo only while the account has one", () => {
    expect(actionsFor(report()).map((row) => row.id)).toEqual(["clear_account_photo"]);
    expect(actionsFor(report({ targetAccount: person(null) }))).toEqual([]);
    expect(actionsFor(report({ targetAccount: null }))).toEqual([]);
  });

  it("offers no account action for a report filed in a community", () => {
    expect(actionsFor({ ...report(), communityId: "cm_1" })).toEqual([]);
  });

  const onPost = (over: Partial<Report> = {}) =>
    report({
      reportId: "rep9",
      communityId: "cm_1",
      target: { kind: "post", id: "p1" },
      reason: "unlawful",
      ...over,
    });

  it("offers removal of a reported post or comment in a community", () => {
    expect(actionsFor(onPost()).map((row) => row.id)).toEqual(["remove_post"]);
    expect(
      actionsFor(onPost({ target: { kind: "comment", id: "c1" } })).map((row) => row.id),
    ).toEqual(["remove_comment"]);
    expect(actionsFor(onPost({ communityId: null, targetAccount: null }))).toEqual([]);
  });

  it("removes the post through its community's route with the report's id, and the report leaves", async () => {
    const calls = noCalls();
    const reports = [onPost(), report({ reportId: "rep2" })];
    const row = actionsFor(reports[0]!)[0]!;
    const done = await act(calls, reports[0]!, row, " Ólöglegt ");
    expect(done.ok).toBe(true);
    expect(calls.moderate).toHaveBeenCalledWith({
      path: { communityId: "cm_1" },
      body: { action: "remove_post", targetId: "p1", reason: "Ólöglegt", reportId: "rep9" },
    });
    expect(calls.moderatePlatform).not.toHaveBeenCalled();
    expect(without(reports, new Set(["rep9"])).map((r) => r.reportId)).toEqual(["rep2"]);
  });

  it("clears the photo with the report's id, and the report leaves the queue", async () => {
    const calls = noCalls();
    const reports = [report(), report({ reportId: "rep2" })];
    const done = await act(calls, reports[0]!, actionsFor(reports[0]!)[0]!, "  Ástæða  ");
    expect(done.ok).toBe(true);
    expect(calls.moderatePlatform).toHaveBeenCalledWith({
      body: {
        action: "clear_account_photo",
        targetId: "acc1",
        reason: "Ástæða",
        reportId: "rep1",
      },
    });
    expect(without(reports, new Set(["rep1"])).map((r) => r.reportId)).toEqual(["rep2"]);
  });

  it("dismisses through the close route with the report's id", async () => {
    const calls = noCalls();
    const done = await dismiss(calls, report(), "Ekkert að");
    expect(done.ok).toBe(true);
    expect(calls.closeReport).toHaveBeenCalledWith({
      path: { reportId: "rep1" },
      body: { resolution: "Ekkert að" },
    });
  });

  it("keeps the report when the server refuses the action", async () => {
    const calls: Calls = {
      ...noCalls(),
      moderatePlatform: vi.fn(() =>
        Promise.resolve({
          status: 404 as const,
          data: { error: "not_found", requestId: "r1" },
        }),
      ),
    };
    const done = await act(calls, report(), actionsFor(report())[0]!, "Ástæða");
    expect(done.ok).toBe(false);
  });
});

describe("the platform log", () => {
  it("renders the clear_account_photo entry with who, which account and why", () => {
    const html = renderToStaticMarkup(<LogEntries entries={[entry]} target />);
    expect(html).toContain(strings.moderation_decision_clear_account_photo);
    expect(html).toContain("Ástæða aðgerðar");
    expect(html).toContain(`${strings.platform_account}: Reikningur Eitt`);
  });
});

describe("a person the server refuses", () => {
  it("sees the refusal and neither the queue nor the log", () => {
    const html = renderToStaticMarkup(
      <PlatformView
        queue={paged<Report>({
          problem: { kind: "refused", code: "not_permitted", requestId: null },
        })}
        log={paged<ModerationLogEntry>({
          problem: { kind: "refused", code: "not_permitted", requestId: null },
        })}
        calls={noCalls()}
        done={() => undefined}
      />,
    );
    expect(html).toContain(strings.problem_not_permitted);
    expect(html).not.toContain(strings.moderation_queue);
    expect(html).not.toContain(strings.moderation_log_title);
  });

  it("sees the queue and the log once the server answers", () => {
    const html = renderToStaticMarkup(
      <PlatformView
        queue={paged<Report>({ items: [report()] })}
        log={paged<ModerationLogEntry>({ items: [entry] })}
        calls={noCalls()}
        done={() => undefined}
      />,
    );
    expect(html).toContain(strings.moderation_queue);
    expect(html).toContain(strings.moderation_log_title);
    expect(html).not.toContain(strings.problem_not_permitted);
  });
});
