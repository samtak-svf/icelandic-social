import { useEffect, useState } from "react";
import { resolveCards, type Card, type Report, type ReportTarget } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { authorName, AuthorName } from "./author-name.tsx";
import { outcome, when } from "./outcome.ts";

// What a report queue shows of a report, shared by a community's queue and
// Samtak's (decisions 0066, 0115): why it was made, the content it is about,
// and what a closed one came to.

export const REASONS = {
  unlawful: strings.report_reason_unlawful,
  harassment: strings.report_reason_harassment,
  spam: strings.report_reason_spam,
  other: strings.report_reason_other,
} as const;

const DECISIONS: Record<NonNullable<Report["decision"]>, string> = {
  hide_post: strings.moderation_decision_hide_post,
  remove_post: strings.moderation_decision_remove_post,
  restore_post: strings.moderation_decision_restore_post,
  hide_comment: strings.moderation_decision_hide_comment,
  remove_comment: strings.moderation_decision_remove_comment,
  restore_comment: strings.moderation_decision_restore_comment,
  mute_member: strings.moderation_decision_mute_member,
  unmute_member: strings.moderation_decision_unmute_member,
  remove_member: strings.moderation_decision_remove_member,
  ban_member: strings.moderation_decision_ban_member,
  unban_member: strings.moderation_decision_unban_member,
  clear_account_photo: strings.moderation_decision_clear_account_photo,
  suspend_account: strings.moderation_decision_suspend_account,
  unsuspend_account: strings.moderation_decision_unsuspend_account,
  dismissed: strings.moderation_decision_dismissed,
  community_deleted: strings.moderation_decision_community_deleted,
};

export type Content = ReportTarget & { kind: "post" | "comment" };
export const isContent = (target: ReportTarget): target is Content =>
  target.kind === "post" || target.kind === "comment";

/** The cards of the posts and comments reported, by id. */
export function useCards(reports: Report[]): Map<string, Card> {
  const [cards, setCards] = useState(new Map<string, Card>());
  const refs = reports
    .map((r) => r.target)
    .filter(isContent)
    .map((t) => ({ kind: t.kind, id: t.id }));
  const key = refs.map((r) => r.id).join(",");
  useEffect(() => {
    let live = true;
    if (key !== "") {
      void outcome(resolveCards({ body: { refs } }), 200).then((resolved) => {
        if (live && resolved.ok) setCards(new Map(resolved.data.cards.map((c) => [c.ref.id, c])));
      });
    }
    return () => {
      live = false;
    };
    // The refs are the key's; a new array of the same refs is no new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cards;
}

/** The reported content, with its author unless the post is anonymous (decision 0091). */
export function Quoted({ report, card }: Readonly<{ report: Report; card: Card | undefined }>) {
  if (!card || card.kind === "unavailable" || card.kind === "community") return null;
  return (
    <blockquote className="rounded-md bg-muted p-3">
      <p>
        {report.targetAnonymous ? (
          <span className="font-semibold">{strings.post_anonymous_author}</span>
        ) : (
          <AuthorName author={card.author} />
        )}
      </p>
      <p className="whitespace-pre-wrap">{card.excerpt}</p>
    </blockquote>
  );
}

/** What a closed report came to: the decision, its reason, who and when (#360). */
export function Decision({ report }: Readonly<{ report: Report }>) {
  const date = report.closedAt === null ? null : when(report.closedAt);
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
      {report.decision !== null && <p className="font-semibold">{DECISIONS[report.decision]}</p>}
      {report.resolution !== null && report.resolution !== "" && (
        <p className="whitespace-pre-wrap">{report.resolution}</p>
      )}
      {date !== null && (
        <p className="text-sm text-muted-fg">
          {report.closedBy === null
            ? strings.moderation_closed_at({ date })
            : strings.moderation_closed_by({ name: authorName(report.closedBy), date })}
        </p>
      )}
    </div>
  );
}
