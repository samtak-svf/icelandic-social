import { parseFraming, type Framing } from "../../api/image-frames.ts";
import { db } from "../../env/index.ts";
import { newCommunityId } from "./communities.ts";

// A person's wall (decision 0115) is a space with a `communities` row of its
// own kind, no member and a random id, found only through `walls`. Its row's
// name, key and description hold that id: a community row outlives its purge by
// a year with its name, and a person's name stays out of it.

export type Wall = { communityId: string; cover: string | null; coverFrames: Framing | null };

/** The account whose wall `communityId` is, or null when it is no live wall. */
export async function wallAt(env: Env, communityId: string): Promise<string | null> {
  const row = await db(env)
    .prepare(
      `SELECT w.account_id AS accountId FROM walls w
         JOIN live_spaces s ON s.community_id = w.community_id
        WHERE w.community_id = ?`,
    )
    .bind(communityId)
    .first<{ accountId: string }>();
  return row?.accountId ?? null;
}

/** `accountId`'s wall, or null when it has none yet. */
export async function wallOf(env: Env, accountId: string): Promise<Wall | null> {
  const row = await db(env)
    .prepare(
      `SELECT s.community_id AS communityId, s.cover_version AS cover, s.cover_frames AS frames
         FROM walls w JOIN live_spaces s ON s.community_id = w.community_id
        WHERE w.account_id = ?`,
    )
    .bind(accountId)
    .first<{ communityId: string; cover: string | null; frames: string | null }>();
  return (
    row && { communityId: row.communityId, cover: row.cover, coverFrames: parseFraming(row.frames) }
  );
}

/** Which of the spaces `ids` are walls, whether or not their row is live. */
export async function wallsAmong(env: Env, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db(env)
    .prepare(
      `SELECT community_id AS id FROM communities
        WHERE kind = 'wall' AND community_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** `accountId`'s wall, created at its first post or cover. Two at once make one. */
export async function ensureWall(env: Env, accountId: string): Promise<Wall> {
  const found = await wallOf(env, accountId);
  if (found) return found;
  const id = newCommunityId();
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO communities (community_id, name, name_key, description, audience, kind, created_at)
         SELECT ?1, ?1, ?1, ?1, 'private', 'wall', ?2
          WHERE NOT EXISTS (SELECT 1 FROM walls WHERE account_id = ?3)`,
      )
      .bind(id, Date.now(), accountId),
    db(env)
      .prepare(
        `INSERT OR IGNORE INTO walls (account_id, community_id)
         SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM communities WHERE community_id = ?2)`,
      )
      .bind(accountId, id),
  ]);
  const made = await wallOf(env, accountId);
  if (!made) throw new Error("wall not created");
  return made;
}

/** Whether a community or a wall lives at `communityId`. */
export async function spaceExists(env: Env, communityId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT 1 AS found FROM live_spaces WHERE community_id = ?")
    .bind(communityId)
    .first<{ found: number }>();
  return row !== null;
}

/**
 * What a person's own export names each of `ids` (decision 0126): a wall has no
 * name of its own, a community has its name, and a space with no live row (it was
 * deleted) is listed unnamed.
 */
export async function spaceLabels(
  env: Env,
  ids: string[],
): Promise<Map<string, { kind: "wall" | "community"; name: string | null }>> {
  const labels = new Map<string, { kind: "wall" | "community"; name: string | null }>();
  if (ids.length === 0) return labels;
  const { results } = await db(env)
    .prepare(
      `SELECT community_id AS id, kind, name FROM live_spaces
        WHERE community_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: string; kind: string; name: string }>();
  for (const r of results) {
    labels.set(
      r.id,
      r.kind === "wall" ? { kind: "wall", name: null } : { kind: "community", name: r.name },
    );
  }
  return labels;
}
