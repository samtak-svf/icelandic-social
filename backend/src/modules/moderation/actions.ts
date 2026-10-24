import { ACTIONS, type Action } from "../../api/moderation.ts";
import {
  canRead,
  moderates,
  sanction,
  standing,
  type Sanction,
  type Standing,
} from "../communities/index.ts";
import {
  authors,
  commentContent,
  moderateComment,
  moderatePost,
  postContent,
  type Content,
} from "../social/index.ts";
import { space } from "../../env/index.ts";
import { notice } from "../jobs/index.ts";
import { entry } from "./log.ts";
import { closing, openReport } from "./reports.ts";

// What a moderator does (decision 0063): who may, to whom, and the log's entry
// that goes with every action (decision 0066).

/** An account's rank in a community: an action reaches only a lower one. */
function rank(s: Standing): number {
  if (s.platformModerator) return 3;
  if (s.role === "owner") return 2;
  return s.role === "moderator" ? 1 : 0;
}

/** The caller's standing as a moderator of `communityId`, or why it is not one. */
export async function actor(
  env: Env,
  accountId: string,
  communityId: string,
  options: { deleted?: boolean } = {},
): Promise<Standing | "not_found" | "not_permitted"> {
  // Only reading a deleted community's log and reports passes `deleted` (0070).
  const found = await standing(env, accountId, communityId, options);
  if (!found || !(canRead(found) || found.platformModerator)) return "not_found";
  return rank(found) > 0 ? found : "not_permitted";
}

type Input = {
  action: Action;
  targetId: string;
  reason: string;
  until?: number;
  reportId?: string;
};
type Refusal = "invalid_request" | "not_permitted" | "not_found";

const STATES = { hide: "hidden", remove: "removed", restore: "visible" } as const;

/** Whether a member sanction can be applied to an account standing as `s`. */
function applies(action: Sanction["action"], s: Standing): boolean {
  if (action === "ban") return !s.banned;
  if (action === "unban") return s.banned;
  return s.role !== null;
}

/** The target's content, when it is content, and the account it reaches; null when not here. */
async function targetOf(
  env: Env,
  communityId: string,
  input: Input,
): Promise<{ content: Content | null; targetAccount: string } | null> {
  const kind = ACTIONS[input.action];
  if (kind === "account") {
    const known = (await authors(env, [input.targetId])).has(input.targetId);
    return known ? { content: null, targetAccount: input.targetId } : null;
  }
  const content = await (kind === "post" ? postContent : commentContent)(env, input.targetId);
  return content?.communityId === communityId ? { content, targetAccount: content.authorId } : null;
}

/** The open report `input` closes, null when none, or why it may not. */
async function reportOf(
  env: Env,
  me: Standing,
  communityId: string,
  input: Input,
): Promise<{ reportId: string } | null | Refusal> {
  if (!input.reportId) return null;
  const report = await openReport(env, input.reportId);
  if (report?.communityId !== communityId) return "not_found";
  return report.toPlatform && !me.platformModerator ? "not_permitted" : report;
}

/** Writes what `input` does to its target, with `entries` in the same write. */
async function apply(
  env: Env,
  communityId: string,
  input: Input,
  target: { content: Content | null; targetAccount: string },
  entries: D1PreparedStatement[],
): Promise<void> {
  const [verb, noun] = input.action.split("_") as [string, string];
  if (target.content) {
    const state = STATES[verb as keyof typeof STATES];
    if (noun === "post") {
      await moderatePost(env, input.targetId, state, entries);
      // A post hidden or removed is no longer pinned (decision 0080).
      if (state !== "visible") await space(env, communityId).unpinPost(input.targetId);
    } else await moderateComment(env, communityId, input.targetId, state, entries);
    return;
  }
  const what: Sanction =
    verb === "mute"
      ? { action: "mute", until: input.until ?? 0 }
      : { action: verb as Exclude<Sanction["action"], "mute"> };
  await sanction(env, communityId, target.targetAccount, what, entries);
}

/** The notice to the author of content a moderator hid or removed (decision 0063). */
function told(
  env: Env,
  accountId: string,
  communityId: string,
  input: Input,
  target: { content: Content | null; targetAccount: string },
): D1PreparedStatement[] {
  if (!target.content || input.action.startsWith("restore_")) return [];
  const comment = ACTIONS[input.action] === "comment";
  return [
    notice(env, `${input.targetId}:${input.action}:${Date.now()}`, {
      kind: "moderated",
      accountId: target.targetAccount,
      actorId: accountId,
      communityId,
      postId: target.content.postId,
      ...(comment ? { commentId: input.targetId } : {}),
      action: input.action,
    }),
  ];
}

/** Does `input` as `accountId` in `communityId`; what refused it, or null when done. */
export async function act(
  env: Env,
  accountId: string,
  communityId: string,
  input: Input,
): Promise<Refusal | null> {
  if ((input.action === "mute_member") !== (input.until !== undefined)) return "invalid_request";
  if (input.until !== undefined && input.until <= Date.now()) return "invalid_request";
  const me = await actor(env, accountId, communityId);
  if (typeof me === "string") return me;

  const target = await targetOf(env, communityId, input);
  const standingThere = target && (await standing(env, target.targetAccount, communityId));
  if (!target || !standingThere) return "not_found";
  // A post waiting for approval is published or declined, not hidden or removed (0091).
  if ((target.content?.state as string | undefined) === "pending") return "invalid_request";
  if (rank(standingThere) >= rank(me)) return "not_permitted";
  const verb = input.action.split("_")[0] as Sanction["action"];
  if (!target.content && !applies(verb, standingThere)) return "not_found";
  const report = await reportOf(env, me, communityId, input);
  if (typeof report === "string") return report;

  const entries = [
    entry(env, {
      communityId,
      actorId: accountId,
      asPlatform: !moderates(me),
      action: input.action,
      targetKind: ACTIONS[input.action],
      targetId: input.targetId,
      targetAccount: target.targetAccount,
      reason: input.reason,
    }),
    ...(report ? [closing(env, report.reportId, accountId, input.action, input.reason)] : []),
    ...told(env, accountId, communityId, input, target),
  ];
  await apply(env, communityId, input, target, entries);
  return null;
}
