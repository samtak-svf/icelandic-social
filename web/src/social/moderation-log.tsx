import type { ModerationLogEntry } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDateTime } from "../lib/is-format.ts";
import { when } from "./outcome.ts";

// The entries of a moderation log, as a community's Stjórna and Samtak's
// platform screen both list them (decisions 0063, 0115).

/** The actions on a community that are kept, told with the words the queue uses. */
const LOGGED: Record<ModerationLogEntry["action"], string> = {
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
  clear_account_bio: strings.moderation_decision_clear_account_bio,
  clear_account_cover: strings.moderation_decision_clear_account_cover,
  read_reported: strings.moderation_decision_read_reported,
  suspend_account: strings.moderation_decision_suspend_account,
  unsuspend_account: strings.moderation_decision_unsuspend_account,
  close_report: strings.moderation_decision_dismissed,
  delete_community: strings.moderation_decision_community_deleted,
  restore_community: strings.community_restore,
  set_community_picture: strings.moderation_log_community_picture_set,
  remove_community_picture: strings.moderation_log_community_picture_removed,
  set_community_cover: strings.moderation_log_community_cover_set,
  remove_community_cover: strings.moderation_log_community_cover_removed,
  pin_post: strings.moderation_log_post_pinned,
  unpin_post: strings.moderation_log_post_unpinned,
  close_poll: strings.moderation_log_poll_closed,
  anonymous_posts_on: strings.moderation_log_anonymous_on,
  anonymous_posts_off: strings.moderation_log_anonymous_off,
  reveal_author: strings.moderation_log_author_revealed,
  review_upheld: strings.moderation_log_review_upheld,
  review_overturned: strings.moderation_log_review_overturned,
};

/**
 * What was decided, in one sentence. A suspension says how long it was for, and
 * having no end date is said as such: it stands until a moderator lifts it.
 */
export function decisionText({
  action,
  until,
}: Readonly<{ action: ModerationLogEntry["action"]; until: number | null }>): string {
  if (action !== "suspend_account") return LOGGED[action];
  return until === null
    ? strings.moderation_decision_suspend_account_open
    : strings.moderation_decision_suspend_account_until({ date: formatIsDateTime(until) });
}

/** The entries as given, newest first; the account acted on is named with `target`. */
export function LogEntries({
  entries,
  target = false,
}: Readonly<{ entries: ModerationLogEntry[]; target?: boolean }>) {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.entryId} className="flex flex-col gap-1 rounded-md bg-muted p-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">{decisionText(entry)}</span>
            <time
              dateTime={new Date(entry.createdAt).toISOString()}
              className="text-sm text-muted-fg"
            >
              {when(entry.createdAt)}
            </time>
          </div>
          {entry.actor !== null && (
            <p className="text-sm text-muted-fg">{entry.actor.name ?? strings.person_unnamed}</p>
          )}
          {target && entry.targetAccount !== null && (
            <p className="text-sm text-muted-fg">
              {strings.platform_account}: {entry.targetAccount.name ?? strings.person_unnamed}
            </p>
          )}
          {entry.reason !== "" && <p className="whitespace-pre-wrap">{entry.reason}</p>}
        </li>
      ))}
    </ul>
  );
}
