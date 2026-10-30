import {
  ACTIONS,
  PLATFORM_ACTIONS,
  type Action,
  type PlatformAction,
} from "../../api/moderation.ts";
import {
  canRead,
  moderates,
  sanction,
  standing,
  type Sanction,
  type Standing,
} from "../communities/index.ts";
import { setSuspension, suspension, type Suspension } from "../../identity/index.ts";
import { removePhoto } from "../profiles/index.ts";
import {
  authors,
  commentContent,
  moderateComment,
  moderatePost,
  postContent,
  type Author,
  type Content,
} from "../social/index.ts";
import { space } from "../../env/index.ts";
import { notice } from "../jobs/index.ts";
import { entry } from "./log.ts";
import { closing, isPlatformModerator, openReport, type OpenReport } from "./reports.ts";

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
  me: Pick<Standing, "platformModerator">,
  communityId: string | null,
  input: { reportId?: string },
): Promise<OpenReport | null | Refusal> {
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

/** Why `me` may not act on the account `target` reaches, or null when it may. */
async function reaches(
  env: Env,
  me: Standing,
  communityId: string,
  input: Input,
  target: { content: Content | null; targetAccount: string },
): Promise<Refusal | null> {
  // An anonymous post is moderated as a post, whoever wrote it: an answer that
  // turned on the author's standing or rank would name them without a logged
  // reveal (0091).
  if (target.content?.anonymous === 1) return null;
  const standingThere = await standing(env, target.targetAccount, communityId);
  if (!standingThere) return "not_found";
  if (rank(standingThere) >= rank(me)) return "not_permitted";
  const verb = input.action.split("_")[0] as Sanction["action"];
  return !target.content && !applies(verb, standingThere) ? "not_found" : null;
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
  if (!target) return "not_found";
  // A post waiting for approval is published or declined, not hidden or removed (0091).
  if ((target.content?.state as string | undefined) === "pending") return "invalid_request";
  const reached = await reaches(env, me, communityId, input, target);
  if (reached) return reached;
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
    ...(report ? closing(env, report.reportId, accountId, input.action, input.reason) : []),
    ...told(env, accountId, communityId, input, target),
  ];
  await apply(env, communityId, input, target, entries);
  return null;
}

/**
 * What each platform action needs of the account, and how it is written with
 * the entries that go with it. A bio and a cover each take one row here and one
 * value in `PLATFORM_ACTIONS` (decision 0115). A suspension always applies, since
 * a new one replaces what stands; there must be one to lift.
 */
const ON_ACCOUNT: Record<
  PlatformAction,
  {
    applies: (target: Author, suspended: Suspension | null) => boolean;
    write: (
      env: Env,
      accountId: string,
      entries: D1PreparedStatement[],
      until: number | null,
    ) => Promise<void>;
  }
> = {
  clear_account_photo: {
    applies: (target) => target.photo !== null,
    write: (env, accountId, entries) => removePhoto(env, accountId, entries),
  },
  suspend_account: {
    applies: () => true,
    write: (env, accountId, entries, until) => setSuspension(env, accountId, { until }, entries),
  },
  unsuspend_account: {
    applies: (_, suspended) => suspended !== null,
    write: (env, accountId, entries) => setSuspension(env, accountId, null, entries),
  },
};

/**
 * Does `input` as the platform moderator `accountId`, on an account and in no
 * community (decision 0115); what refused it, or null when done. The caller
 * is asked first, so that nobody else learns which accounts exist. A report it
 * closes is on the same account: one in a community closes by `act`.
 */
export async function actOnAccount(
  env: Env,
  accountId: string,
  input: {
    action: PlatformAction;
    targetId: string;
    reason: string;
    reportId?: string;
    until?: number | undefined;
  },
): Promise<Refusal | null> {
  if (!(await isPlatformModerator(env, accountId))) return "not_permitted";
  // No rank reaches its own (decision 0066), and a moderator is not its own exception.
  if (await isPlatformModerator(env, input.targetId)) return "not_permitted";
  const { until } = input;
  if (until !== undefined && (input.action !== "suspend_account" || until <= Date.now())) {
    return "invalid_request";
  }
  const target = (await authors(env, [input.targetId])).get(input.targetId);
  const does = ON_ACCOUNT[input.action];
  if (!target || !does.applies(target, await suspension(env, input.targetId))) return "not_found";
  const report = await reportOf(env, { platformModerator: true }, null, input);
  if (typeof report === "string") return report;
  if (report && report.targetAccount !== input.targetId) return "not_found";

  const entries = [
    entry(env, {
      communityId: null,
      actorId: accountId,
      asPlatform: true,
      action: input.action,
      targetKind: PLATFORM_ACTIONS[input.action],
      targetId: input.targetId,
      targetAccount: input.targetId,
      reason: input.reason,
      suspendedUntil: until ?? null,
    }),
    ...(report ? closing(env, report.reportId, accountId, input.action, input.reason) : []),
    // There is no community, so this is a row older clients are not shown (0114).
    notice(env, `${input.targetId}:${input.action}:${Date.now()}`, {
      kind: "moderated",
      accountId: input.targetId,
      actorId: accountId,
      communityId: null,
      action: input.action,
    }),
  ];
  await does.write(env, input.targetId, entries, until ?? null);
  return null;
}
