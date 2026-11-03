import { db, mediaBucket } from "../../env/index.ts";
import { toHex } from "../../shared/bytes.ts";
import { heldGroups } from "../social/index.ts";
import {
  importPost,
  type ImportResult,
  type ImportSource,
  keyOf,
  openImport,
  type SourcePost,
} from "./core.ts";

// What a direct transfer brings in (decision 0129), on the same core as a file or a feed.
// A person has one standing import from each exporter, which every transfer adds to and
// which is reviewed, opened and removed like any other. Everything comes in held (0127).
// A photo is staged in R2 until its album has gone quiet, and then gathered into posts
// the way an export file's photos are (transfer-gather.ts).

/** The most items one standing import takes in, so that one exporter cannot fill the store. */
const MAX_TRANSFER_ITEMS = 50_000;

/** Who a transfer comes from: the exporter's client, and the source its posts are kept under. */
export type Exporter = { clientId: string; source: string };

type Standing = ImportSource & { items: number };

/** The staged photo's key, under the import, so that removing the import removes it. */
export const stagedKey = (importId: string, photoId: string) =>
  `${keyOf(importId)}/transfer/${photoId}`;

/** The person's standing import from the exporter, opened on the first item. */
async function standing(env: Env, accountId: string, exporter: Exporter): Promise<Standing> {
  const row = await db(env)
    .prepare(
      `SELECT t.import_id AS importId, t.items, s.audience, s.removing_at AS removingAt
         FROM transfer_imports t JOIN import_sources s ON s.import_id = t.import_id
        WHERE t.account_id = ? AND t.client_id = ?`,
    )
    .bind(accountId, exporter.clientId)
    .first<{
      importId: string;
      items: number;
      audience: Standing["audience"];
      removingAt: number | null;
    }>();
  if (row && row.removingAt === null) {
    return {
      importId: row.importId,
      accountId,
      source: exporter.source,
      audience: row.audience,
      items: row.items,
    };
  }
  // One being removed is let go, and what comes next starts a new one.
  if (row) {
    await db(env)
      .prepare("DELETE FROM transfer_imports WHERE import_id = ?")
      .bind(row.importId)
      .run();
  }
  const opened = await openImport(env, accountId, { kind: "page", source: exporter.source });
  const made = await db(env)
    .prepare(
      `INSERT OR IGNORE INTO transfer_imports (account_id, client_id, import_id) VALUES (?, ?, ?)`,
    )
    .bind(accountId, exporter.clientId, opened.importId)
    .run();
  if (made.meta.changes === 1) return { ...opened, items: 0 };
  // Another item opened it first.
  await db(env)
    .prepare("DELETE FROM import_sources WHERE import_id = ?")
    .bind(opened.importId)
    .run();
  return standing(env, accountId, exporter);
}

function touch(env: Env, importId: string, taken: number, left: number) {
  return db(env)
    .prepare(
      `UPDATE transfer_imports SET items = items + ?, left_behind = left_behind + ?, last_item_at = ?
        WHERE import_id = ?`,
    )
    .bind(taken, left, Date.now(), importId)
    .run();
}

/** A social post, brought in held; "full" when the import has no room left. */
export async function receivePost(
  env: Env,
  accountId: string,
  exporter: Exporter,
  post: SourcePost,
): Promise<ImportResult | "full"> {
  const source = await standing(env, accountId, exporter);
  if (source.items >= MAX_TRANSFER_ITEMS) return "full";
  const result = await importPost(env, source, post, "backlog");
  await touch(env, source.importId, result.outcome === "imported" ? 1 : 0, 0);
  return result;
}

/** An album, which the photos after it name; a repeat updates its name. */
export async function receiveAlbum(
  env: Env,
  accountId: string,
  exporter: Exporter,
  album: { albumId: string; name: string; description: string },
): Promise<void> {
  const source = await standing(env, accountId, exporter);
  await db(env)
    .prepare(
      `INSERT INTO transfer_albums (import_id, album_id, name, description) VALUES (?, ?, ?, ?)
       ON CONFLICT (import_id, album_id) DO UPDATE SET name = excluded.name,
         description = excluded.description`,
    )
    .bind(source.importId, album.albumId, album.name, album.description)
    .run();
  await touch(env, source.importId, 0, 0);
}

/** A photo, staged until it is gathered; "already" when the same bytes came before. */
export async function receivePhoto(
  env: Env,
  accountId: string,
  exporter: Exporter,
  photo: { bytes: Uint8Array; albumId: string | null; takenAt: number; caption: string },
): Promise<"staged" | "already" | "full"> {
  const source = await standing(env, accountId, exporter);
  const photoId = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", photo.bytes)));
  const known = await db(env)
    .prepare("SELECT 1 FROM transfer_photos WHERE import_id = ? AND photo_id = ?")
    .bind(source.importId, photoId)
    .first();
  if (known) return "already";
  if (source.items >= MAX_TRANSFER_ITEMS) return "full";
  await mediaBucket(env).put(stagedKey(source.importId, photoId), photo.bytes);
  await db(env)
    .prepare(
      `INSERT OR IGNORE INTO transfer_photos
         (import_id, photo_id, album_id, taken_at, caption, received_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(source.importId, photoId, photo.albumId, photo.takenAt, photo.caption, Date.now())
    .run();
  await touch(env, source.importId, 1, 0);
  return "staged";
}

/** An item acknowledged and not brought in: a video, or a file past the limit. */
export async function leftBehind(env: Env, accountId: string, exporter: Exporter): Promise<void> {
  const source = await standing(env, accountId, exporter);
  await touch(env, source.importId, 0, 1);
}

export type TransferSummary = {
  importId: string;
  posts: number;
  held: number;
  leftBehind: number;
  lastItemAt: number | null;
};

/** What the person's standing import from the exporter holds, or null before the first item. */
export async function transferSummary(
  env: Env,
  accountId: string,
  clientId: string,
): Promise<TransferSummary | null> {
  const row = await db(env)
    .prepare(
      `SELECT t.import_id AS importId, t.left_behind AS leftBehind, t.last_item_at AS lastItemAt,
              (SELECT COUNT(*) FROM imported_posts i WHERE i.import_id = t.import_id) AS posts
         FROM transfer_imports t JOIN import_sources s ON s.import_id = t.import_id
        WHERE t.account_id = ? AND t.client_id = ? AND s.removing_at IS NULL`,
    )
    .bind(accountId, clientId)
    .first<Omit<TransferSummary, "held">>();
  if (!row) return null;
  const { posts: held } = await heldGroups(env, accountId, row.importId);
  return { ...row, held };
}
