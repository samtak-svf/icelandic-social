import { closeReport, moderatePlatform, type Report } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Outcome } from "./outcome.ts";
import { outcome } from "./outcome.ts";

// What a platform moderator does with a report on an account (decision 0115),
// apart from how it is drawn, so it is tested without a browser.

export type PlatformAction = Parameters<typeof moderatePlatform>[0]["body"]["action"];

/** The calls this module makes, as an argument so a test supplies its own. */
export interface Calls {
  moderatePlatform: typeof moderatePlatform;
  closeReport: typeof closeReport;
}

export const live: Calls = { moderatePlatform, closeReport };

export interface Row {
  verb: PlatformAction;
  label: string;
  confirm: string;
  applies: (report: Report) => boolean;
}

/**
 * What a platform moderator may do about an account, one row each: the same
 * shape as `ON_ACCOUNT` on the backend, so suspending an account, or clearing
 * its bio, takes one row here and one value in the contract's action enum.
 * `applies` mirrors what the server checks: an account with the thing to
 * clear, and a report with no community, since one filed in a community is
 * closed by that community's route, not by an action on the account.
 */
const ON_ACCOUNT: readonly Row[] = [
  {
    verb: "clear_account_photo",
    label: strings.platform_clear_photo,
    confirm: strings.platform_clear_photo_confirm,
    applies: (report) => report.communityId === null && report.targetAccount?.photo != null,
  },
];

/** The rows that apply to the account `report` is about, in table order. */
export function actionsFor(report: Report): Row[] {
  return ON_ACCOUNT.filter((row) => row.applies(report));
}

/** The account a report is about, when it is about one. */
function accountOf(report: Report): string | null {
  if (report.target.kind === "account") return report.target.id;
  return report.targetAccount?.accountId ?? null;
}

/** `verb` on the account of `report`, which the same call closes. */
export function act(
  calls: Calls,
  report: Report,
  verb: PlatformAction,
  reason: string,
): Promise<Outcome<undefined>> {
  const targetId = accountOf(report);
  if (targetId === null) {
    // Nothing to act on: the same answer the server gives for a missing account.
    return Promise.resolve({
      ok: false,
      status: 404,
      problem: { kind: "refused", code: "not_found", requestId: null },
    });
  }
  return outcome(
    calls.moderatePlatform({
      body: { action: verb, targetId, reason: reason.trim(), reportId: report.reportId },
    }),
    204,
  );
}

/** Closes `report` with no action taken. */
export function dismiss(calls: Calls, report: Report, reason: string): Promise<Outcome<undefined>> {
  return outcome(
    calls.closeReport({ path: { reportId: report.reportId }, body: { resolution: reason.trim() } }),
    204,
  );
}

/** The queue without the reports already dealt with. */
export function without(reports: Report[], gone: ReadonlySet<string>): Report[] {
  return reports.filter((report) => !gone.has(report.reportId));
}
