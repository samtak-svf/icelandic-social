import { db, mediaBucket } from "../../env/index.ts";
import { log } from "../../shared/log.ts";
import { job, type Handler } from "../jobs/index.ts";
import { importPost, type ImportSource } from "./core.ts";
import { type OwnPhoto, photoPosts } from "./export-photos.ts";
import { stagedKey } from "./transfer.ts";

// Gathering a transfer's staged photos into posts (decision 0129). An exporter sends an
// album and then its photos one by one, with nothing to say the album is done, so the
// photos wait until none has arrived for QUIET_MS. They are then grouped as an export
// file's are (by album, day and caption, at most one post's worth together) and come in
// held. A run takes PER_RUN photos, and the next run takes the rest.

const GATHER = "transfers.gather";
const QUIET_MS = 10 * 60 * 1000;
const PER_RUN = 20;

/** Starts gathering every import whose staged photos have gone quiet. */
export async function startDueTransfers(env: Env, now = Date.now()): Promise<void> {
  const { results } = await db(env)
    .prepare(
      `SELECT import_id AS importId, MAX(received_at) AS latest FROM transfer_photos
        WHERE posted = 0 GROUP BY import_id HAVING MAX(received_at) <= ? LIMIT 25`,
    )
    .bind(now - QUIET_MS)
    .all<{ importId: string; latest: number }>();
  if (results.length === 0) return;
  await db(env).batch(results.map(({ importId, latest }) => gatherJob(env, importId, latest, 0)));
}

const gatherJob = (env: Env, importId: string, latest: number, part: number) =>
  job(env, {
    kind: GATHER,
    key: `${GATHER}:${importId}:${latest}:${part}`,
    payload: { importId, latest, part },
  });

type Staged = {
  photoId: string;
  takenAt: number;
  caption: string;
  name: string | null;
  description: string | null;
};

const gather: Handler = async (env, _key, payload) => {
  const { importId, latest, part } = payload as { importId: string; latest: number; part: number };
  const source = await db(env)
    .prepare(
      `SELECT import_id AS importId, account_id AS accountId, source, audience
         FROM import_sources WHERE import_id = ? AND removing_at IS NULL`,
    )
    .bind(importId)
    .first<ImportSource>();
  if (!source) return;
  const { results } = await db(env)
    .prepare(
      `SELECT p.photo_id AS photoId, p.taken_at AS takenAt, p.caption, a.name, a.description
         FROM transfer_photos p
         LEFT JOIN transfer_albums a ON a.import_id = p.import_id AND a.album_id = p.album_id
        WHERE p.import_id = ? AND p.posted = 0 AND p.received_at <= ?
        ORDER BY p.album_id, p.taken_at, p.photo_id LIMIT ?`,
    )
    .bind(importId, latest, PER_RUN + 1)
    .all<Staged>();
  const taken = results.slice(0, PER_RUN);
  const photos: OwnPhoto[] = taken.map((photo) => ({
    path: photo.photoId,
    seconds: Math.floor(photo.takenAt / 1000),
    caption: photo.caption,
    title: [photo.name ?? "", photo.description ?? ""].filter((text) => text !== "").join("\n\n"),
    class: photo.name === null ? "uncategorized" : "album",
  }));
  const bucket = mediaBucket(env);
  const load = (photoId: string) => async () => {
    const object = await bucket.get(stagedKey(importId, photoId));
    return object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
  };
  let posts = 0;
  for (const item of await photoPosts(photos, new Set())) {
    const result = await importPost(
      env,
      source,
      {
        id: `dtp:${item.id}`,
        createdAt: item.at,
        body: item.body,
        images: item.images.map(load),
        class: item.class,
      },
      "backlog",
    );
    if (result.outcome === "stopped") return;
    if (result.outcome === "imported") posts += 1;
  }
  const ids = taken.map((photo) => photo.photoId);
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE transfer_photos SET posted = 1
          WHERE import_id = ? AND photo_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(importId, JSON.stringify(ids)),
    ...(results.length > PER_RUN ? [gatherJob(env, importId, latest, part + 1)] : []),
  ]);
  if (ids.length > 0) await bucket.delete(ids.map((id) => stagedKey(importId, id)));
  log("transfers.gathered", { accountId: source.accountId, count: posts });
};

/** The handlers of the jobs gathering runs. */
export const transferJobHandlers = (): Record<string, Handler> => ({ [GATHER]: gather });
