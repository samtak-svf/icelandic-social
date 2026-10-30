import {
  closeReport,
  decideModerationReview,
  moderate,
  moderatePlatform,
  type OpenModerationReview,
  type Report,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Outcome } from "./outcome.ts";
import { outcome } from "./outcome.ts";

// What a platform moderator does with a report or a review (decision 0115),
// apart from how it is drawn, so it is tested without a browser.

/** The calls this module makes, as an argument so a test supplies its own. */
export interface Calls {
  moderate: typeof moderate;
  moderatePlatform: typeof moderatePlatform;
  closeReport: typeof closeReport;
  decideModerationReview: typeof decideModerationReview;
}

export const live: Calls = { moderate, moderatePlatform, closeReport, decideModerationReview };

export interface Row<T = Report> {
  /** Names the row, and keys its button. */
  id: string;
  label: string;
  confirm: string;
  applies: (item: T) => boolean;
  /** The call the row makes: the platform route for an account, the community's for content. */
  call: (calls: Calls, item: T, reason: string) => Promise<Outcome<undefined>>;
}

/** The post or comment a report in a community is about, when it is one. */
const contentOf = (report: Report): { communityId: string; id: string } | null =>
  report.communityId !== null && (report.target.kind === "post" || report.target.kind === "comment")
    ? { communityId: report.communityId, id: report.target.id }
    : null;

/** Removes the reported post or comment through its community's route, which closes the report. */
const removeContent = (kind: "post" | "comment"): Row => ({
  id: `remove_${kind}`,
  label: strings.moderation_remove,
  confirm: strings.platform_remove_confirm,
  applies: (report) => contentOf(report) !== null && report.target.kind === kind,
  call: (calls, report, reason) => {
    const content = contentOf(report);
    if (content === null) return notFound();
    return outcome(
      calls.moderate({
        path: { communityId: content.communityId },
        body: {
          action: `remove_${kind}`,
          targetId: content.id,
          reason: reason.trim(),
          reportId: report.reportId,
        },
      }),
      204,
    );
  },
});

const notFound = () =>
  Promise.resolve<Outcome<undefined>>({
    ok: false,
    status: 404,
    problem: { kind: "refused", code: "not_found", requestId: null },
  });

/** The account a report is about, when it is about one. */
const accountOf = (report: Report): string | null =>
  report.target.kind === "account" ? report.target.id : (report.targetAccount?.accountId ?? null);

/** Clears the photo of the reported account through the platform route, which closes the report. */
const clearPhoto: Row = {
  id: "clear_account_photo",
  label: strings.platform_clear_photo,
  confirm: strings.platform_clear_photo_confirm,
  // The platform route closes only a report with no community.
  applies: (report) => report.communityId === null && report.targetAccount?.photo != null,
  call: (calls, report, reason) => {
    const targetId = accountOf(report);
    if (targetId === null) return notFound();
    return outcome(
      calls.moderatePlatform({
        body: {
          action: "clear_account_photo",
          targetId,
          reason: reason.trim(),
          reportId: report.reportId,
        },
      }),
      204,
    );
  },
};

/**
 * What a platform moderator may do about a report, one row each, so a new
 * action (suspending an account, clearing its bio) takes one row here and one
 * value in the contract's action enum. `applies` mirrors what the server checks;
 * hiding and restoring content stay the community's own tools.
 */
const ACTIONS: readonly Row[] = [clearPhoto, removeContent("post"), removeContent("comment")];

/** The rows that apply to `report`, in table order. */
export function actionsFor(report: Report): Row[] {
  return ACTIONS.filter((row) => row.applies(report));
}

/** Answers a review through the one route that decides it. */
const decide = (outcome_: "upheld" | "overturned", label: string, confirm: string) => {
  const row: Row<OpenModerationReview> = {
    id: outcome_,
    label,
    confirm,
    applies: (review) => review.canDecide,
    call: (calls, review, reason) =>
      outcome(
        calls.decideModerationReview({
          path: { entryId: String(review.entryId) },
          body: { outcome: outcome_, reason: reason.trim() },
        }),
        204,
      ),
  };
  return row;
};

/** What a platform moderator may answer a review with: the same table, the same order every time. */
const REVIEW_ACTIONS: readonly Row<OpenModerationReview>[] = [
  decide("upheld", strings.platform_review_uphold, strings.platform_review_uphold_confirm),
  decide("overturned", strings.platform_review_overturn, strings.platform_review_overturn_confirm),
];

/** The rows that apply to `review`: none for the one who acted or asked. */
export function reviewActionsFor(review: OpenModerationReview): Row<OpenModerationReview>[] {
  return REVIEW_ACTIONS.filter((row) => row.applies(review));
}

/** Does `row` for `item`, with the moderator's reason. */
export function act<T>(calls: Calls, item: T, row: Row<T>, reason: string) {
  return row.call(calls, item, reason);
}

/** Closes `report` with no action taken. */
export function dismiss(calls: Calls, report: Report, reason: string): Promise<Outcome<undefined>> {
  return outcome(
    calls.closeReport({ path: { reportId: report.reportId }, body: { resolution: reason.trim() } }),
    204,
  );
}

/** The reviews without the ones already answered. */
export function undecided(
  reviews: OpenModerationReview[],
  gone: ReadonlySet<number>,
): OpenModerationReview[] {
  return reviews.filter((review) => !gone.has(review.entryId));
}

/** The queue without the reports already dealt with. */
export function without(reports: Report[], gone: ReadonlySet<string>): Report[] {
  return reports.filter((report) => !gone.has(report.reportId));
}
