import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  askReviewRoute,
  decideReviewRoute,
  openReviewsRoute,
  REVIEWABLE,
  statementsRoute,
} from "../../api/moderation-reviews.ts";
import type { REVIEW_OUTCOMES } from "../../api/moderation.ts";
import { db } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { setSuspension, suspension } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { notice } from "../jobs/index.ts";
import {
  authors,
  commentContent,
  keptText,
  moderateComment,
  moderatePost,
  postContent,
  postOfComment,
} from "../social/index.ts";
import { entry } from "./log.ts";
import { isPlatformModerator } from "./reports.ts";

// The statement of reasons and the single review (decisions 0063, 0115). What a
// person reads comes from the log's own entry, so it says what the moderator
// wrote and nothing else; the actor stays out of it. The table is keyed on the
// entry and a trigger refuses a second decision (migration 0039), so neither
// depends on a check made before the write.

type Reviewable = (typeof REVIEWABLE)[number];
type TargetKind = "post" | "comment" | "account";

type Row = {
  as_platform: number;
  on_wall: number;
  entry_id: number;
  community_id: string | null;
  actor_id: string | null;
  action: Reviewable;
  target_kind: TargetKind;
  target_id: string;
  target_account: string | null;
  reason: string;
  created_at: number;
  suspended_until: number | null;
  account_id: string | null;
  state: "open" | "upheld" | "overturned" | null;
  asked_at: number | null;
  decided_at: number | null;
  review_reason: string | null;
  restored: number | null;
};

const LISTED = REVIEWABLE.map((a) => `'${a}'`).join(", ");

const SELECTED = `l.as_platform,
       EXISTS (SELECT 1 FROM walls w WHERE w.community_id = l.community_id) AS on_wall,
       l.entry_id, l.community_id, l.actor_id, l.action, l.target_kind, l.target_id,
       l.target_account, l.reason, l.created_at, l.suspended_until, r.account_id, r.state, r.asked_at, r.decided_at,
       r.reason AS review_reason, r.restored`;

/**
 * The entries about ?1's content. An anonymous post's entries name no author
 * (decision 0091), so those are found by the post, while its index row lasts:
 * after a purge nothing links the entry to its author, and this is why.
 */
const OWN = `l.entry_id IN (
    SELECT entry_id FROM moderation_log WHERE target_account = ?1
    UNION ALL
    SELECT x.entry_id FROM post_index p JOIN moderation_log x ON x.target_id = p.post_id
     WHERE p.author_id = ?1 AND p.anonymous = 1 AND x.target_kind = 'post')
  AND l.action IN (${LISTED})`;

/** The target's state, or null when it no longer exists. */
async function targetState(env: Env, r: Row): Promise<string | null> {
  if (r.target_kind === "account") return null;
  const read = r.target_kind === "post" ? postContent : commentContent;
  return (await read(env, r.target_id))?.state ?? null;
}

const textOf = (env: Env, r: Row) =>
  r.community_id === null || r.target_kind === "account"
    ? Promise.resolve(null)
    : keptText(env, r.community_id, r.target_kind, r.target_id);

/** A wall's owner removing a comment: their wall to keep, with no review (decision 0115). */
const ownersOwn = (r: Row) => r.on_wall === 1 && r.as_platform === 0;

/** A page of what moderators did to `accountId`'s content, newest first. */
async function statementPage(
  env: Env,
  accountId: string,
  before: string | undefined,
  limit: number,
) {
  const { results } = await db(env)
    .prepare(
      `SELECT ${SELECTED} FROM moderation_log l
         LEFT JOIN moderation_reviews r ON r.entry_id = l.entry_id
        WHERE ${OWN} AND (?2 IS NULL OR l.entry_id < ?2)
        ORDER BY l.entry_id DESC LIMIT ?3`,
    )
    .bind(accountId, before === undefined ? null : Number(before), limit + 1)
    .all<Row>();
  const page = results.slice(0, limit);
  return {
    statements: await Promise.all(
      page.map(async (r) => ({
        entryId: r.entry_id,
        action: r.action,
        target: { kind: r.target_kind, id: r.target_id },
        communityId: r.community_id,
        reason: r.reason,
        createdAt: r.created_at,
        until: r.suspended_until,
        body: await textOf(env, r),
        canAsk: r.state === null && !ownersOwn(r) && (await targetState(env, r)) !== "visible",
        review:
          r.state === null || r.asked_at === null
            ? null
            : {
                state: r.state,
                askedAt: r.asked_at,
                decidedAt: r.decided_at,
                reason: r.review_reason,
                restored: r.restored === 1,
              },
      })),
    ),
    next: results.length > limit ? String(page.at(-1)?.entry_id) : null,
  };
}

/** Asks for the review of `entryId` as `accountId`; what refused it, or null when asked. */
async function ask(
  env: Env,
  accountId: string,
  entryId: number,
): Promise<"not_found" | "restored" | "already_asked" | null> {
  const row = await db(env)
    .prepare(
      `SELECT ${SELECTED} FROM moderation_log l
         LEFT JOIN moderation_reviews r ON r.entry_id = l.entry_id
        WHERE ${OWN} AND l.entry_id = ?2`,
    )
    .bind(accountId, entryId)
    .first<Row>();
  if (!row || ownersOwn(row)) return "not_found";
  if ((await targetState(env, row)) === "visible") return "restored";
  const { meta } = await db(env)
    .prepare(
      "INSERT OR IGNORE INTO moderation_reviews (entry_id, account_id, asked_at) VALUES (?, ?, ?)",
    )
    .bind(entryId, accountId, Date.now())
    .run();
  return meta.changes === 0 ? "already_asked" : null;
}

const OPEN = `SELECT ${SELECTED} FROM moderation_reviews r
         JOIN moderation_log l ON l.entry_id = r.entry_id
        WHERE r.state = 'open'`;

/** The post to open for what `r` is about, when it is about one. */
function postOf(r: Row): string | null {
  if (r.target_kind === "post") return r.target_id;
  return r.target_kind === "comment" ? postOfComment(r.target_id) : null;
}

/** A page of the reviews waiting, as the platform moderator `accountId` reads them. */
async function openReviews(env: Env, accountId: string, before: string | undefined, limit: number) {
  const { results } = await db(env)
    .prepare(`${OPEN} AND (?1 IS NULL OR r.entry_id < ?1) ORDER BY r.entry_id DESC LIMIT ?2`)
    .bind(before === undefined ? null : Number(before), limit + 1)
    .all<Row>();
  const page = results.slice(0, limit);
  const names = await authors(
    env,
    page.flatMap((r) => [r.actor_id, r.target_account].filter((id) => id !== null)),
  );
  const named = (id: string | null) => (id === null ? null : (names.get(id) ?? null));
  return {
    reviews: await Promise.all(
      page.map(async (r) => ({
        entryId: r.entry_id,
        action: r.action,
        target: { kind: r.target_kind, id: r.target_id },
        communityId: r.community_id,
        postId: postOf(r),
        actor: named(r.actor_id),
        targetAccount: named(r.target_account),
        reason: r.reason,
        createdAt: r.created_at,
        until: r.suspended_until,
        // A wall's text is read only on an open report, logged (0115).
        body: r.on_wall === 1 ? null : await textOf(env, r),
        askedAt: r.asked_at ?? r.created_at,
        canDecide: r.actor_id !== accountId && r.account_id !== accountId,
      })),
    ),
    next: results.length > limit ? String(page.at(-1)?.entry_id) : null,
  };
}

type Outcome = (typeof REVIEW_OUTCOMES)[number];
type Refused = "not_permitted" | "not_found" | "already_decided";

/** Whether a hide or a remove of `r`'s target came after `r`, and so still stands over it. */
async function overtaken(env: Env, r: Row): Promise<boolean> {
  const later = await db(env)
    .prepare(
      `SELECT 1 AS yes FROM moderation_log
        WHERE target_kind = ? AND target_id = ? AND entry_id > ? AND action IN (${LISTED})
        LIMIT 1`,
    )
    .bind(r.target_kind, r.target_id, r.entry_id)
    .first();
  return later !== null;
}

/** Whether a later suspension of `r`'s account decides now: the latest does. */
async function laterSuspension(env: Env, r: Row): Promise<boolean> {
  const later = await db(env)
    .prepare(
      `SELECT 1 AS yes FROM moderation_log
        WHERE target_kind = 'account' AND target_id = ? AND entry_id > ? AND action = 'suspend_account'
        LIMIT 1`,
    )
    .bind(r.target_id, r.entry_id)
    .first();
  return later !== null;
}

/**
 * Whether a review's answer brings its target back, the entry that says so when
 * this write is what does it, and the write. Only an overturn can. Read here and
 * not at the asking, since a newer decision can land while the review waits:
 * overturning the older one does not undo it. A target a moderator has already
 * restored since is back, and needs no write and no entry.
 */
async function restoring(
  env: Env,
  r: Row,
  outcome: Outcome,
): Promise<{
  restored: boolean;
  action: "restore_post" | "restore_comment" | "unsuspend_account" | null;
  write: (s: D1PreparedStatement[]) => Promise<unknown>;
}> {
  const batch = (s: D1PreparedStatement[]) => db(env).batch(s);
  const nothing = { action: null, write: batch };
  if (outcome === "overturned" && r.action === "suspend_account") {
    if (!(await suspension(env, r.target_id))) return { restored: true, ...nothing };
    if (await laterSuspension(env, r)) return { restored: false, ...nothing };
    return {
      restored: true,
      action: "unsuspend_account",
      write: (s) => setSuspension(env, r.target_id, null, s),
    };
  }
  if (outcome !== "overturned" || r.community_id === null || r.target_kind === "account") {
    return { restored: false, ...nothing };
  }
  const state = await targetState(env, r);
  if (state === "visible") return { restored: true, ...nothing };
  if (state === null || (await overtaken(env, r))) return { restored: false, ...nothing };
  const communityId = r.community_id;
  return r.target_kind === "post"
    ? {
        restored: true,
        action: "restore_post",
        write: (s) => moderatePost(env, r.target_id, "visible", s),
      }
    : {
        restored: true,
        action: "restore_comment",
        write: (s) => moderateComment(env, communityId, r.target_id, "visible", s),
      };
}

/**
 * Decides the review of `entryId` as `accountId`; what refused it, or null when
 * done. The answer, its log entry and its notice are one write, with the restoring
 * when the post is what comes back. A restoring is logged as one, in an entry of
 * its own, so that a replay of the log (decision 0068) need not know what an overturn
 * means; the review's notice tells the person. Nobody decides what they did or asked.
 */
async function decide(
  env: Env,
  accountId: string,
  entryId: number,
  input: { outcome: Outcome; reason: string },
): Promise<Refused | null> {
  if (!(await isPlatformModerator(env, accountId))) return "not_permitted";
  const r = await db(env).prepare(`${OPEN} AND r.entry_id = ?`).bind(entryId).first<Row>();
  if (!r) {
    const there = await db(env)
      .prepare("SELECT 1 AS yes FROM moderation_reviews WHERE entry_id = ?")
      .bind(entryId)
      .first();
    return there ? "already_decided" : "not_found";
  }
  if (r.actor_id === accountId || r.account_id === accountId) return "not_permitted";

  const { restored, action: restoration, write } = await restoring(env, r, input.outcome);
  const action = input.outcome === "overturned" ? "review_overturned" : "review_upheld";
  const logged = (a: typeof action | NonNullable<typeof restoration>) =>
    entry(env, {
      communityId: r.community_id,
      actorId: accountId,
      asPlatform: true,
      action: a,
      targetKind: r.target_kind,
      targetId: r.target_id,
      // The original entry's, not the asker's: an anonymous post's stays null
      // even when the post is purged by now and no longer marks it anonymous.
      targetAccount: r.target_account,
      reason: input.reason,
    });
  const statements = [
    db(env)
      .prepare(
        `UPDATE moderation_reviews
            SET state = ?, decided_by = ?, decided_at = ?, reason = ?, restored = ?,
                account_id = ?
          WHERE entry_id = ?`,
      )
      .bind(
        input.outcome,
        accountId,
        Date.now(),
        input.reason,
        restored ? 1 : 0,
        // An anonymous post's author is not kept beside its entry once answered (0091).
        r.target_account === null ? null : r.account_id,
        entryId,
      ),
    logged(action),
    ...(restoration === null ? [] : [logged(restoration)]),
    ...(r.account_id === null
      ? []
      : [
          notice(env, `${entryId}:${action}`, {
            kind: "moderated",
            accountId: r.account_id,
            actorId: accountId,
            communityId: r.community_id,
            ...(postOf(r) ? { postId: postOf(r) as string } : {}),
            ...(r.target_kind === "comment" ? { commentId: r.target_id } : {}),
            action,
          }),
        ]),
  ];
  try {
    await write(statements);
  } catch (error) {
    // Two moderators at once: the trigger took the whole second write back.
    if (String(error).includes("moderation_reviews already decided")) return "already_decided";
    throw error;
  }
  return null;
}

export function reviewRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(statementsRoute, async (c) => {
    const { before, limit } = c.req.valid("query");
    return c.json(await statementPage(c.env, c.var.session.accountId, before, limit), 200);
  });

  app.openapi(askReviewRoute, async (c) => {
    const { accountId } = c.var.session;
    const refused = await ask(c.env, accountId, Number(c.req.valid("param").entryId));
    if (refused === "not_found") return fail(c, 404, refused);
    if (refused) return fail(c, 409, refused);
    log("review.asked", { accountId });
    return c.body(null, 204);
  });

  app.openapi(openReviewsRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await isPlatformModerator(c.env, accountId))) return fail(c, 403, "not_permitted");
    const { before, limit } = c.req.valid("query");
    return c.json(await openReviews(c.env, accountId, before, limit), 200);
  });

  app.openapi(decideReviewRoute, async (c) => {
    const { accountId } = c.var.session;
    const entryId = Number(c.req.valid("param").entryId);
    const refused = await decide(c.env, accountId, entryId, c.req.valid("json"));
    if (refused === "not_permitted") return fail(c, 403, refused);
    if (refused === "not_found") return fail(c, 404, refused);
    if (refused) return fail(c, 409, refused);
    log("review.decided", { accountId });
    return c.body(null, 204);
  });
}
