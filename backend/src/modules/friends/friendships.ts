import { db } from "../../env/index.ts";
import { likeLiteral, nameKey } from "../profiles/index.ts";
import { SUMMARY, summaryOf, type SummaryRow } from "./summary.ts";

// A friendship (decision 0114): two directed rows, written and removed in one
// batch, so a list reads one direction and a mutual is a join of two.

/** The most friends an account may have, refused at accept. */
const MAX_FRIENDS = 1000;

export function befriending(env: Env, one: string, other: string, now: number) {
  const row = (a: string, b: string) =>
    db(env)
      .prepare(
        `INSERT INTO friendships (account_id, friend_id, since) VALUES (?, ?, ?)
         ON CONFLICT (account_id, friend_id) DO NOTHING`,
      )
      .bind(a, b, now);
  return [row(one, other), row(other, one)];
}

export function endingFriendship(env: Env, one: string, other: string) {
  return [
    db(env)
      .prepare(
        `DELETE FROM friendships
          WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)`,
      )
      .bind(one, other),
  ];
}

/** SQL: `one` and `other` are not friends; either direction's row says so, since both are written together. */
export const NOT_FRIENDS = (one: string, other: string) =>
  `NOT EXISTS (SELECT 1 FROM friendships f WHERE f.account_id = ${one} AND f.friend_id = ${other})`;

export async function areFriends(env: Env, one: string, other: string): Promise<boolean> {
  const found = await db(env)
    .prepare("SELECT 1 FROM friendships WHERE account_id = ? AND friend_id = ?")
    .bind(one, other)
    .first();
  return found !== null;
}

/** Whether either account is at the most friends it may have. */
export async function cappedEither(env: Env, one: string, other: string): Promise<boolean> {
  const row = await db(env)
    .prepare(
      `SELECT MAX(n) AS most FROM (SELECT COUNT(*) AS n FROM friendships WHERE account_id = ?1
                                   UNION ALL
                                   SELECT COUNT(*) FROM friendships WHERE account_id = ?2)`,
    )
    .bind(one, other)
    .first<{ most: number }>();
  return (row?.most ?? 0) >= MAX_FRIENDS;
}

export type FriendSort = "newest" | "name";

/**
 * `me`'s friends and how many there are. The cap keeps the list small enough to
 * return whole, so it has no pages. `q` matches as the directory's does (0038).
 * Nobody else's list is ever read: another's shows only its count and mutuals.
 */
export async function friendList(
  env: Env,
  me: string,
  options: { query?: string; sort: FriendSort },
) {
  const order = options.sort === "name" ? "a.name_key, a.account_id" : "f.since DESC, a.account_id";
  const [count, listed] = await db(env).batch<{ n: number } & SummaryRow & { since: number }>([
    db(env).prepare("SELECT COUNT(*) AS n FROM friendships WHERE account_id = ?").bind(me),
    db(env)
      .prepare(
        `SELECT ${SUMMARY}, f.since
           FROM friendships f JOIN accounts a ON a.account_id = f.friend_id
          WHERE f.account_id = ?1
            AND (?2 IS NULL
                 OR a.name_key LIKE ?2 || '%' ESCAPE '\\'
                 OR a.name_key LIKE '% ' || ?2 || '%' ESCAPE '\\'
                 OR a.name_key LIKE '%-' || ?2 || '%' ESCAPE '\\')
          ORDER BY ${order}`,
      )
      .bind(me, options.query === undefined ? null : likeLiteral(nameKey(options.query))),
  ]);
  return {
    count: count?.results[0]?.n ?? 0,
    friends: (listed?.results ?? []).map((r) => ({ person: summaryOf(r), since: r.since })),
  };
}

/** Everything of `accountId` in friendships, requests and snoozes, both ways. */
export function forgettingFriends(env: Env, accountId: string): D1PreparedStatement[] {
  return [
    db(env)
      .prepare("DELETE FROM friendships WHERE account_id = ?1 OR friend_id = ?1")
      .bind(accountId),
    db(env)
      .prepare("DELETE FROM friend_requests WHERE from_account = ?1 OR to_account = ?1")
      .bind(accountId),
    db(env)
      .prepare("DELETE FROM person_snoozes WHERE account_id = ?1 OR target_id = ?1")
      .bind(accountId),
  ];
}
