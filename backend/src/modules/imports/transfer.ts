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

/**
 * The most bytes one person lets one exporter stage and fetch, in photos and in the images
 * of posts: 2 GiB. It is counted in transfer_budgets, which removing the import leaves alone,
 * so removing and sending again does not buy more room.
 */
const MAX_TRANSFER_BYTES = 2 * 1024 ** 3;

/** Who a transfer comes from: the exporter's client, and the source its posts are kept under. */
export type Exporter = { clientId: string; source: string };

type Standing = ImportSource & { clientId: string };

/** The staged photo's key, under the import, so that removing the import removes it. */
export const stagedKey = (importId: string, photoId: string) =>
  `${keyOf(importId)}/transfer/${photoId}`;

/** The person's standing import from the exporter, opened on the first item. */
async function standing(env: Env, accountId: string, exporter: Exporter): Promise<Standing> {
  const row = await db(env)
    .prepare(
      `SELECT t.import_id AS importId, s.audience, s.removing_at AS removingAt
         FROM transfer_imports t JOIN import_sources s ON s.import_id = t.import_id
        WHERE t.account_id = ? AND t.client_id = ?`,
    )
    .bind(accountId, exporter.clientId)
    .first<{
      importId: string;
      audience: Standing["audience"];
      removingAt: number | null;
    }>();
  if (row && row.removingAt === null) {
    return {
      importId: row.importId,
      accountId,
      source: exporter.source,
      audience: row.audience,
      clientId: exporter.clientId,
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
  if (made.meta.changes === 1) return { ...opened, clientId: exporter.clientId };
  // Another item opened it first.
  await db(env)
    .prepare("DELETE FROM import_sources WHERE import_id = ?")
    .bind(opened.importId)
    .run();
  return standing(env, accountId, exporter);
}

function touch(env: Env, importId: string, left: number) {
  return db(env)
    .prepare(
      `UPDATE transfer_imports SET left_behind = left_behind + ?, last_item_at = ?
        WHERE import_id = ?`,
    )
    .bind(left, Date.now(), importId)
    .run();
}

/**
 * Takes room for one item, or false when the import is full. One conditional UPDATE, so
 * parallel items cannot all pass a check made before any of them is counted.
 */
async function takeRoom(env: Env, importId: string): Promise<boolean> {
  const taken = await db(env)
    .prepare("UPDATE transfer_imports SET items = items + 1 WHERE import_id = ? AND items < ?")
    .bind(importId, MAX_TRANSFER_ITEMS)
    .run();
  return taken.meta.changes === 1;
}

const giveRoom = (env: Env, importId: string) =>
  db(env)
    .prepare("UPDATE transfer_imports SET items = items - 1 WHERE import_id = ? AND items > 0")
    .bind(importId)
    .run();

/** Counts `size` bytes against the budget, or false when they would pass it; atomically. */
async function takeBytes(env: Env, source: Standing, size: number): Promise<boolean> {
  await db(env)
    .prepare("INSERT OR IGNORE INTO transfer_budgets (account_id, client_id) VALUES (?, ?)")
    .bind(source.accountId, source.clientId)
    .run();
  const taken = await db(env)
    .prepare(
      `UPDATE transfer_budgets SET bytes = bytes + ?
        WHERE account_id = ? AND client_id = ? AND bytes + ? <= ?`,
    )
    .bind(size, source.accountId, source.clientId, size, MAX_TRANSFER_BYTES)
    .run();
  return taken.meta.changes === 1;
}

/** Thrown from inside an image's load when its bytes would pass the budget. */
class OverBudget extends Error {}

/** A social post, brought in held; "full" when the import has no room left. */
export async function receivePost(
  env: Env,
  accountId: string,
  exporter: Exporter,
  post: SourcePost,
): Promise<ImportResult | "full"> {
  const source = await standing(env, accountId, exporter);
  if (!(await takeRoom(env, source.importId))) return "full";
  // The images are fetched while the post is made; each is counted before it is kept.
  const counted: SourcePost = {
    ...post,
    images: post.images.map((load) => async () => {
      const bytes = await load();
      if (bytes.byteLength > 0 && !(await takeBytes(env, source, bytes.byteLength)))
        throw new OverBudget();
      return bytes;
    }),
  };
  let result: ImportResult;
  try {
    result = await importPost(env, source, counted, "backlog");
  } catch (error) {
    await giveRoom(env, source.importId);
    if (error instanceof OverBudget) return "full";
    throw error;
  }
  if (result.outcome !== "imported") await giveRoom(env, source.importId);
  await touch(env, source.importId, 0);
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
  await touch(env, source.importId, 0);
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
  if (!(await takeRoom(env, source.importId))) return "full";
  // Both counts are taken before anything is written to R2.
  if (!(await takeBytes(env, source, photo.bytes.byteLength))) {
    await giveRoom(env, source.importId);
    return "full";
  }
  await mediaBucket(env).put(stagedKey(source.importId, photoId), photo.bytes);
  await db(env)
    .prepare(
      `INSERT OR IGNORE INTO transfer_photos
         (import_id, photo_id, album_id, taken_at, caption, received_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(source.importId, photoId, photo.albumId, photo.takenAt, photo.caption, Date.now())
    .run();
  await touch(env, source.importId, 0);
  return "staged";
}

/** An item acknowledged and not brought in: a video, or a file past the limit. */
export async function leftBehind(env: Env, accountId: string, exporter: Exporter): Promise<void> {
  const source = await standing(env, accountId, exporter);
  await touch(env, source.importId, 1);
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
