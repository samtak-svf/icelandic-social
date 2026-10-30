import { db } from "../../env/index.ts";
import { blockedEither } from "../../identity/index.ts";
import { notice } from "../jobs/index.ts";
import { areFriends, cappedEither, endingFriendship, befriending } from "./friendships.ts";
import { SUMMARY, summaryOf, type SummaryRow } from "./summary.ts";

// A friend request's life (decision 0114). A table row holds a direction's last
// attempt. What its sender can learn is decided by time alone, never by state:
// a declined request reads as a pending one until day 30 and then as an expired
// one, and every refusal to send again is the one clock.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A request stands this long, and a decline reads as one for as long. */
const OPEN_MS = 30 * DAY_MS;
/** One request per direction in this long, counted from its creation, whatever became of it. */
const RESEND_MS = 90 * DAY_MS;
/** New requests one account may send in a rolling day. */
const REQUESTS_PER_DAY = 20;
/** How many a list returns. */
const LISTED = 200;

/**
 * Removes the notice telling `to` of a request from `from`. Notifications are
 * written by their own module, which reads this one, so `compose` passes it in.
 */
export type WithdrawNotice = (env: Env, to: string, from: string) => D1PreparedStatement;

/** Stands for its recipient: pending and inside its 30 days. */
const OPEN_TO_RECIPIENT = "state = 'pending' AND created_at > ?";
/** Stands for its sender, who cannot tell a declined request from a pending one. */
const OPEN_TO_SENDER = "state IN ('pending', 'declined') AND created_at > ?";

/** Whether `from` has a request standing with `to`; a notice about it is still so. */
export async function requestOpen(env: Env, from: string, to: string): Promise<boolean> {
  const found = await db(env)
    .prepare(
      `SELECT 1 FROM friend_requests
        WHERE from_account = ? AND to_account = ? AND ${OPEN_TO_RECIPIENT}`,
    )
    .bind(from, to, Date.now() - OPEN_MS)
    .first();
  return found !== null;
}

export type Relation = "none" | "sent" | "incoming" | "friends";

/** What `viewer` sees between itself and `other`; `friends` has been checked before this. */
export async function requestRelation(
  env: Env,
  viewer: string,
  other: string,
  now = Date.now(),
): Promise<"none" | "sent" | "incoming"> {
  const opened = now - OPEN_MS;
  const [incoming, sent] = await db(env).batch<{ one: number }>([
    db(env)
      .prepare(
        `SELECT 1 AS one FROM friend_requests
          WHERE from_account = ? AND to_account = ? AND ${OPEN_TO_RECIPIENT}`,
      )
      .bind(other, viewer, opened),
    db(env)
      .prepare(
        `SELECT 1 AS one FROM friend_requests
          WHERE from_account = ? AND to_account = ? AND ${OPEN_TO_SENDER}`,
      )
      .bind(viewer, other, opened),
  ]);
  if (incoming?.results.length) return "incoming";
  return sent?.results.length ? "sent" : "none";
}

export type Answered = "ok" | "none" | "friend_limit";

/**
 * `me` accepts `from`'s request: the friendship, the sender told, the notice
 * withdrawn and any request of mine the other way closed, in one batch. The
 * 1,000 is refused here, visibly, and read just before the batch, so two
 * accepts at once can pass it by one.
 */
export async function acceptRequest(
  env: Env,
  me: string,
  from: string,
  withdraw: WithdrawNotice,
  now = Date.now(),
): Promise<Answered> {
  if (!(await requestOpen(env, from, me))) return "none";
  if (await cappedEither(env, me, from)) return "friend_limit";
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE friend_requests SET state = 'accepted', closed_at = ?
          WHERE from_account = ? AND to_account = ? AND state = 'pending'`,
      )
      .bind(now, from, me),
    db(env)
      .prepare(
        `UPDATE friend_requests SET state = 'cancelled', closed_at = ?
          WHERE from_account = ? AND to_account = ? AND state IN ('pending', 'declined')`,
      )
      .bind(now, me, from),
    ...befriending(env, me, from, now),
    withdraw(env, me, from),
    withdraw(env, from, me),
    notice(env, `${from}:${me}:${now}`, {
      kind: "friend_accepted",
      accountId: from,
      actorId: me,
      communityId: null,
    }),
  ]);
  return "ok";
}

export type Sent =
  | { relation: "sent" | "friends" }
  | { refused: "not_found" | "request_refused" | "request_limit" | "friend_limit" };

/** What an earlier request from `from` to `to` says of asking again now, by its age alone. */
async function earlierRequest(env: Env, from: string, to: string, now: number) {
  const last = await db(env)
    .prepare(
      "SELECT state, created_at FROM friend_requests WHERE from_account = ? AND to_account = ?",
    )
    .bind(from, to)
    .first<{ state: string; created_at: number }>();
  if (last === null) return null;
  const stands = ["pending", "declined"].includes(last.state) && last.created_at > now - OPEN_MS;
  if (stands) return "stands";
  return last.created_at > now - RESEND_MS ? "too_soon" : null;
}

/**
 * `from` asks `to`. Asking the one who already asked is accepting them. Asking
 * again while a request stands changes nothing and answers as the first did,
 * so it reads the same whether that request was declined or not.
 */
export async function sendRequest(
  env: Env,
  from: string,
  to: string,
  withdraw: WithdrawNotice,
  now = Date.now(),
): Promise<Sent> {
  const known = await db(env)
    .prepare("SELECT 1 FROM accounts WHERE account_id = ?")
    .bind(to)
    .first();
  if (known === null || (await blockedEither(env, from)).includes(to)) {
    return { refused: "not_found" };
  }
  if (await areFriends(env, from, to)) return { relation: "friends" };
  if (await requestOpen(env, to, from)) {
    const accepted = await acceptRequest(env, from, to, withdraw, now);
    if (accepted === "friend_limit") return { refused: "friend_limit" };
    return { relation: "friends" };
  }
  const earlier = await earlierRequest(env, from, to, now);
  if (earlier === "stands") return { relation: "sent" };
  if (earlier === "too_soon") return { refused: "request_refused" };
  const dayAgo = now - DAY_MS;
  const sentToday = await db(env)
    .prepare("SELECT COUNT(*) AS n FROM friend_requests WHERE from_account = ? AND created_at > ?")
    .bind(from, dayAgo)
    .first<{ n: number }>();
  if ((sentToday?.n ?? 0) >= REQUESTS_PER_DAY) return { refused: "request_limit" };
  const [written] = await db(env).batch([
    // The count is held again inside the write, so two sends at once cannot pass it. A send it
    // stops leaves a notice job that finds no standing request and writes nothing.
    db(env)
      .prepare(
        `INSERT INTO friend_requests (from_account, to_account, state, created_at, closed_at)
         SELECT ?1, ?2, 'pending', ?3, NULL
          WHERE (SELECT COUNT(*) FROM friend_requests
                  WHERE from_account = ?1 AND created_at > ?4) < ${REQUESTS_PER_DAY}
         ON CONFLICT (from_account, to_account) DO UPDATE
           SET state = 'pending', created_at = excluded.created_at, closed_at = NULL`,
      )
      .bind(from, to, now, dayAgo),
    notice(env, `${from}:${to}:${now}`, {
      kind: "friend_request",
      accountId: to,
      actorId: from,
      communityId: null,
    }),
  ]);
  if (!written?.meta.changes) return { refused: "request_limit" };
  return { relation: "sent" };
}

/** `me` declines: `from` is told nothing and goes on reading "sent" until day 30. */
export async function declineRequest(
  env: Env,
  me: string,
  from: string,
  withdraw: WithdrawNotice,
  now = Date.now(),
): Promise<boolean> {
  const [closed] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE friend_requests SET state = 'declined', closed_at = ?
          WHERE from_account = ? AND to_account = ? AND ${OPEN_TO_RECIPIENT}`,
      )
      .bind(now, from, me, now - OPEN_MS),
    withdraw(env, me, from),
  ]);
  return (closed?.meta.changes ?? 0) > 0;
}

/** `me` takes back what it reads as sent, declined or not: the clock keeps running. */
export async function cancelRequest(
  env: Env,
  me: string,
  to: string,
  withdraw: WithdrawNotice,
  now = Date.now(),
): Promise<boolean> {
  const [closed] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE friend_requests SET state = 'cancelled', closed_at = ?
          WHERE from_account = ? AND to_account = ? AND ${OPEN_TO_SENDER}`,
      )
      .bind(now, me, to, now - OPEN_MS),
    withdraw(env, to, me),
  ]);
  return (closed?.meta.changes ?? 0) > 0;
}

/** Either side ends a friendship: nobody is told, and the request's clock is not restarted. */
export async function endFriendship(
  env: Env,
  me: string,
  other: string,
  now = Date.now(),
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE friend_requests SET state = 'ended', closed_at = ?1
          WHERE state = 'accepted'
            AND ((from_account = ?2 AND to_account = ?3) OR (from_account = ?3 AND to_account = ?2))`,
      )
      .bind(now, me, other),
    ...endingFriendship(env, me, other),
  ]);
}

/** Requests between two accounts, both ways and cooldown included: a block clears them. */
export function clearingRequests(env: Env, one: string, other: string): D1PreparedStatement {
  return db(env)
    .prepare(
      `DELETE FROM friend_requests
        WHERE (from_account = ?1 AND to_account = ?2) OR (from_account = ?2 AND to_account = ?1)`,
    )
    .bind(one, other);
}

export type RequestRow = SummaryRow & { created_at: number };

/** The requests standing for `me`, newest first: to it, or from it as it reads them. */
export async function requestLists(env: Env, me: string, now = Date.now()) {
  const opened = now - OPEN_MS;
  const list = (join: string, where: string) =>
    db(env)
      .prepare(
        `SELECT ${SUMMARY}, r.created_at
           FROM friend_requests r JOIN accounts a ON a.account_id = r.${join}
          WHERE ${where} ORDER BY r.created_at DESC, a.account_id LIMIT ${LISTED}`,
      )
      .bind(me, opened);
  const [incoming, sent] = await db(env).batch<RequestRow>([
    list("from_account", "r.to_account = ? AND r.state = 'pending' AND r.created_at > ?"),
    list(
      "to_account",
      "r.from_account = ? AND r.state IN ('pending', 'declined') AND r.created_at > ?",
    ),
  ]);
  const of = (rows: RequestRow[] | undefined) =>
    (rows ?? []).map((r) => ({ person: summaryOf(r), sentAt: r.created_at }));
  return { incoming: of(incoming?.results), sent: of(sent?.results) };
}

/**
 * The daily sweep: a request past its 30 days expires and its notice is
 * withdrawn; a closed row goes once its 90 days are over. A declined request is
 * left as it is, since time alone already reads it as expired. Returns how many
 * expired.
 */
export async function expireRequests(
  env: Env,
  withdraw: WithdrawNotice,
  now = Date.now(),
): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `SELECT from_account, to_account FROM friend_requests
        WHERE state = 'pending' AND created_at <= ?`,
    )
    .bind(now - OPEN_MS)
    .all<{ from_account: string; to_account: string }>();
  for (let i = 0; i < results.length; i += 40) {
    await db(env).batch(
      results.slice(i, i + 40).flatMap((r) => [
        db(env)
          .prepare(
            `UPDATE friend_requests SET state = 'expired', closed_at = ?
              WHERE from_account = ? AND to_account = ? AND state = 'pending'`,
          )
          .bind(now, r.from_account, r.to_account),
        withdraw(env, r.to_account, r.from_account),
      ]),
    );
  }
  await db(env)
    .prepare(
      `DELETE FROM friend_requests
        WHERE state NOT IN ('pending', 'accepted') AND created_at <= ?`,
    )
    .bind(now - RESEND_MS)
    .run();
  return results.length;
}
