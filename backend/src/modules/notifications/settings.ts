import { db } from "../../env/index.ts";

// How loudly an account wants to be told (decision 0106): a level for each
// kind and for each community, the lower applies, and a missing row is `push`.
// Moderation is never below `in_app`, whatever is stored: an account cannot
// switch off being told that a moderator acted on its content.

const KINDS = ["comment", "reply", "reaction", "join_approved", "moderated"] as const;
export type Kind = (typeof KINDS)[number];
export type Level = "off" | "in_app" | "push";

const RANK: Record<Level, number> = { off: 0, in_app: 1, push: 2 };

/** The lower of two levels; a missing one is `push`. */
const lower = (a: Level | null | undefined, b: Level | null | undefined): Level =>
  RANK[a ?? "push"] <= RANK[b ?? "push"] ? (a ?? "push") : (b ?? "push");

/** The level at which `kind` in a community is told, given what is stored for each. */
function effective(
  kind: Kind,
  kindLevel: Level | null | undefined,
  communityLevel: Level | null | undefined,
): Level {
  const level = lower(kindLevel, communityLevel);
  return kind === "moderated" && level === "off" ? "in_app" : level;
}

/** The level at which `accountId` is told of `kind` in `communityId` now. */
export async function levelFor(
  env: Env,
  accountId: string,
  kind: Kind,
  communityId: string,
): Promise<Level> {
  const row = await db(env)
    .prepare(
      `SELECT (SELECT level FROM notification_settings WHERE account_id = ?1 AND kind = ?2) AS k,
              (SELECT level FROM community_notification_settings
                WHERE account_id = ?1 AND community_id = ?3) AS c`,
    )
    .bind(accountId, kind, communityId)
    .first<{ k: Level | null; c: Level | null }>();
  return effective(kind, row?.k, row?.c);
}

/** What `accountId` stored: the kinds' levels (push where none) and the communities' levels. */
export async function settingsOf(env: Env, accountId: string) {
  const [kinds, communities] = await db(env).batch<{ kind: Kind; level: Level }>([
    db(env)
      .prepare("SELECT kind, level FROM notification_settings WHERE account_id = ?")
      .bind(accountId),
    db(env)
      .prepare(
        `SELECT community_id AS communityId, level FROM community_notification_settings
          WHERE account_id = ? ORDER BY community_id`,
      )
      .bind(accountId),
  ]);
  const stored = new Map((kinds?.results ?? []).map((r) => [r.kind, r.level]));
  return {
    kinds: Object.fromEntries(KINDS.map((k) => [k, stored.get(k) ?? "push"])) as Record<
      Kind,
      Level
    >,
    communities: (communities?.results ?? []) as unknown as {
      communityId: string;
      level: Level;
    }[],
  };
}

/** Stores the levels of the kinds given; the others are left as they were. */
export async function setKinds(
  env: Env,
  accountId: string,
  kinds: Partial<Record<Kind, Level>>,
): Promise<void> {
  const given = Object.entries(kinds) as [Kind, Level][];
  if (given.length === 0) return;
  await db(env).batch(
    given.map(([kind, level]) =>
      db(env)
        .prepare(
          `INSERT INTO notification_settings (account_id, kind, level) VALUES (?, ?, ?)
           ON CONFLICT (account_id, kind) DO UPDATE SET level = excluded.level`,
        )
        .bind(accountId, kind, level),
    ),
  );
}

/** Stores the level for one community; `push` is the default, so it deletes the row. */
export async function setCommunityLevel(
  env: Env,
  accountId: string,
  communityId: string,
  level: Level,
): Promise<void> {
  await (
    level === "push"
      ? db(env)
          .prepare(
            "DELETE FROM community_notification_settings WHERE account_id = ? AND community_id = ?",
          )
          .bind(accountId, communityId)
      : db(env)
          .prepare(
            `INSERT INTO community_notification_settings (account_id, community_id, level)
           VALUES (?, ?, ?)
           ON CONFLICT (account_id, community_id) DO UPDATE SET level = excluded.level`,
          )
          .bind(accountId, communityId, level)
  ).run();
}

/** Whether `accountId` is told by push now of a notification of this kind in this community. */
export async function announcer(
  env: Env,
  accountId: string,
): Promise<(row: { kind: Kind; community_id: string }) => boolean> {
  const stored = await settingsOf(env, accountId);
  const community = new Map(stored.communities.map((c) => [c.communityId, c.level]));
  return (row) =>
    effective(row.kind, stored.kinds[row.kind], community.get(row.community_id)) === "push";
}
