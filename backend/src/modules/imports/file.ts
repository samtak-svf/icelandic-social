import { db, mediaBucket } from "../../env/index.ts";
import { abortUpload, PART_SIZE, partLength, partsOf, uploadPart } from "../../shared/multipart.ts";
import type { ItemClass } from "../../api/imports.ts";
import { job } from "../jobs/index.ts";
import { deleteBytes, keyOf, openImport, requestRemoval } from "./core.ts";
import { SOURCE_KEY } from "./export-file.ts";

// An uploaded export file (decision 0119). The ZIP is in the EU media bucket under
// `imports/<importId>`, uploaded with R2 multipart like a history transfer. A parse
// job reads it into preview rows, the person chooses, and a publish job brings the
// chosen posts in, held until they open them (decision 0127); the bytes and the rows
// go when that is done, when the person removes the import, or when 7 days have passed
// with nothing published.

/** The most a file may be: 4 GiB less a byte. */
export const MAX_FILE = 4 * 1024 * 1024 * 1024 - 1;
/** An upload left unpublished this long is deleted. */
export const FILE_MS = 7 * 24 * 60 * 60 * 1000;
/** A publish gets this long from its start, however old the upload was. */
const PUBLISH_MS = 24 * 60 * 60 * 1000;
/** A page of preview rows. */
export const ITEM_PAGE = 50;

/** From a connection's first collection to its first daily run. */
export const SYNC_AFTER_MS = 24 * 60 * 60 * 1000;
export const PARSE = "imports.parse";
export const PUBLISH = "imports.publish";

/** A connection whose first collection is dealt with goes on to its daily runs. */
export const beginSync = (env: Env, importId: string, now: number) =>
  ["import_connections", "import_page_connections"].map((table) =>
    db(env)
      .prepare(
        `UPDATE ${table} SET phase = 'sync', next_run_at = ? WHERE import_id = ? AND phase = 'backlog'`,
      )
      .bind(now + SYNC_AFTER_MS, importId),
  );

type FileState = "uploading" | "parsing" | "ready" | "publishing" | "done" | "failed";

export type FileRow = {
  importId: string;
  accountId: string;
  removing: boolean;
  state: FileState;
  failure: string | null;
  uploadId: string;
  size: number;
  expiresAt: number;
  posts: number;
  images: number;
  videos: number;
  skipped: number;
  earliest: number | null;
  latest: number | null;
  /** JSON: how much each class holds, written when the file was read. */
  classes: string;
  /** JSON: what the file holds that does not come (decision 0127). */
  lost: string;
};

/** What a file import is read as, shared by the one and the list. */
export const FILE_COLUMNS = `s.import_id AS importId, s.account_id AS accountId,
              s.removing_at IS NOT NULL AS removing,
              COALESCE(f.state, 'failed') AS state, f.failure, COALESCE(f.upload_id, '') AS uploadId,
              COALESCE(f.size, 0) AS size, COALESCE(f.expires_at, 0) AS expiresAt,
              COALESCE(f.posts, 0) AS posts, COALESCE(f.images, 0) AS images,
              COALESCE(f.videos, 0) AS videos, COALESCE(f.skipped, 0) AS skipped,
              f.earliest, f.latest, COALESCE(f.classes, '{}') AS classes,
              COALESCE(f.lost, '{}') AS lost`;
export const FILE_FROM = `FROM import_sources s LEFT JOIN import_files f ON f.import_id = s.import_id`;

export type FileRead = Omit<FileRow, "removing"> & { removing: number };

export const fileRow = (row: FileRead): FileRow => ({ ...row, removing: row.removing === 1 });

/**
 * The file import `importId` of `accountId`, or the preview of a connection's first
 * collection, which is read and published the same way; null when it is not theirs. A
 * removal in progress has no file row, so `state` is then only a placeholder.
 */
export async function fileOf(
  env: Env,
  accountId: string,
  importId: string,
): Promise<FileRow | null> {
  const row = await db(env)
    .prepare(
      `SELECT ${FILE_COLUMNS} ${FILE_FROM}
        WHERE s.import_id = ? AND s.account_id = ? AND s.kind IN ('file', 'profile', 'page')`,
    )
    .bind(importId, accountId)
    .first<FileRead>();
  return row && fileRow(row);
}

/** Starts an upload of `size` bytes: the import first, which the file row hangs on. */
export async function createFileImport(
  env: Env,
  accountId: string,
  size: number,
  now = Date.now(),
): Promise<{ importId: string; partSize: number; parts: number } | "too_large"> {
  if (size > MAX_FILE) return "too_large";
  const { importId } = await openImport(env, accountId, { kind: "file", source: SOURCE_KEY });
  try {
    await db(env)
      .prepare(
        `INSERT INTO import_files (import_id, upload_id, size, state, created_at, expires_at)
         VALUES (?, '', ?, 'uploading', ?, ?)`,
      )
      .bind(importId, size, now, now + FILE_MS)
      .run();
    const upload = await mediaBucket(env).createMultipartUpload(keyOf(importId));
    await db(env)
      .prepare("UPDATE import_files SET upload_id = ? WHERE import_id = ?")
      .bind(upload.uploadId, importId)
      .run();
  } catch (error) {
    await db(env).prepare("DELETE FROM import_sources WHERE import_id = ?").bind(importId).run();
    throw error;
  }
  return { importId, partSize: PART_SIZE, parts: partsOf(size) };
}

type Refused = "not_found" | "conflict" | "expired";

/** The file while it can still take parts. */
function uploading(file: FileRow | null, now: number): FileRow | Refused {
  if (!file || file.removing) return "not_found";
  if (file.state !== "uploading") return "conflict";
  return file.expiresAt <= now ? "expired" : file;
}

/** Stores part `part`; the stream must carry exactly the part's length. */
export async function putFilePart(
  env: Env,
  accountId: string,
  importId: string,
  part: number,
  length: number,
  body: ReadableStream<Uint8Array>,
  now = Date.now(),
): Promise<"ok" | Refused | "invalid_request"> {
  const file = uploading(await fileOf(env, accountId, importId), now);
  if (typeof file === "string") return file;
  const expected = partLength(file.size, part);
  if (expected === 0 || length !== expected) return "invalid_request";
  const etag = await uploadPart(
    mediaBucket(env),
    keyOf(importId),
    file.uploadId,
    part,
    length,
    body,
  );
  await db(env)
    .prepare(
      `INSERT INTO import_file_parts (import_id, part_number, etag) VALUES (?, ?, ?)
       ON CONFLICT (import_id, part_number) DO UPDATE SET etag = excluded.etag`,
    )
    .bind(importId, part, etag)
    .run();
  return "ok";
}

/** Completes the upload once every part is stored, and has the parse job read it. */
export async function completeFile(
  env: Env,
  accountId: string,
  importId: string,
  now = Date.now(),
): Promise<"ok" | Refused | "incomplete"> {
  const file = uploading(await fileOf(env, accountId, importId), now);
  if (typeof file === "string") return file;
  const { results } = await db(env)
    .prepare(
      `SELECT part_number AS partNumber, etag FROM import_file_parts
        WHERE import_id = ? ORDER BY part_number`,
    )
    .bind(importId)
    .all<{ partNumber: number; etag: string }>();
  if (results.length !== partsOf(file.size)) return "incomplete";
  await mediaBucket(env).resumeMultipartUpload(keyOf(importId), file.uploadId).complete(results);
  await db(env).batch([
    db(env)
      .prepare(
        "UPDATE import_files SET state = 'parsing' WHERE import_id = ? AND state = 'uploading'",
      )
      .bind(importId),
    job(env, { kind: PARSE, key: `${PARSE}:${importId}`, payload: { importId } }, true),
    db(env).prepare("DELETE FROM import_file_parts WHERE import_id = ?").bind(importId),
  ]);
  return "ok";
}

export type Choice = {
  from?: number | undefined;
  to?: number | undefined;
  excluded?: string[] | undefined;
  classes?: ItemClass[] | undefined;
};

/** Starts bringing in what the person chose, held: nobody else sees it until they open it. */
export async function publishFile(
  env: Env,
  accountId: string,
  importId: string,
  choice: Choice,
  now = Date.now(),
): Promise<"ok" | "not_found" | "conflict"> {
  const file = await fileOf(env, accountId, importId);
  if (!file || file.removing) return "not_found";
  if (file.state !== "ready") return "conflict";
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE import_files
            SET state = 'publishing', from_at = ?2, to_at = ?3, excluded = ?4, expires_at = ?5,
                chosen_classes = ?6
          WHERE import_id = ?1 AND state = 'ready'`,
      )
      .bind(
        importId,
        choice.from ?? null,
        choice.to ?? null,
        JSON.stringify(choice.excluded ?? []),
        now + PUBLISH_MS,
        JSON.stringify(choice.classes ?? ["own"]),
      ),
    job(
      env,
      { kind: PUBLISH, key: `${PUBLISH}:${importId}:0`, payload: { importId, part: 0 } },
      true,
    ),
  ]);
  return "ok";
}

/** Deletes the upload and the preview rows: the bytes first, so none outlives its row. */
export async function dropFile(env: Env, importId: string): Promise<void> {
  const file = await db(env)
    .prepare("SELECT state, upload_id AS uploadId FROM import_files WHERE import_id = ?")
    .bind(importId)
    .first<{ state: FileState; uploadId: string }>();
  if (!file) return;
  if (file.state === "uploading") {
    if (file.uploadId) await abortUpload(mediaBucket(env), keyOf(importId), file.uploadId);
  } else {
    await deleteBytes(env, importId);
  }
  await db(env).prepare("DELETE FROM import_files WHERE import_id = ?").bind(importId).run();
}

/**
 * Removes an import: what it brought in goes by the core's removal, the upload at once,
 * and a connection runs no more. Both routes reach a connection, since its preview is
 * read and published as a file is.
 */
export async function removeFile(
  env: Env,
  accountId: string,
  importId: string,
): Promise<"ok" | "not_found"> {
  if (!(await fileOf(env, accountId, importId))) return "not_found";
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE import_connections
            SET next_run_at = NULL, run_id = NULL, run_started_at = NULL, run_month = NULL,
                run_ceiling = NULL
          WHERE import_id = ?`,
      )
      .bind(importId),
    // The token goes now: a removal may take a while and nothing reads with it again.
    db(env)
      .prepare(
        `UPDATE import_page_connections SET next_run_at = NULL, run_started_at = NULL, token = ''
          WHERE import_id = ?`,
      )
      .bind(importId),
  ]);
  if (!(await requestRemoval(env, accountId, importId))) return "not_found";
  await dropFile(env, importId);
  return "ok";
}

/** Deletes the uploads and previews past their time (decision 0119); how many. */
export async function expireFiles(env: Env, now = Date.now()): Promise<number> {
  const { results } = await db(env)
    .prepare(
      "SELECT import_id AS importId, state FROM import_files WHERE expires_at <= ? AND state != 'done'",
    )
    .bind(now)
    .all<{ importId: string; state: FileState }>();
  for (const { importId, state } of results) {
    await dropFile(env, importId);
    // A publish may have brought posts in, and the import is then the handle to undo
    // them; one that never got that far is only a row.
    if (state !== "publishing") {
      await db(env).prepare("DELETE FROM import_sources WHERE import_id = ?").bind(importId).run();
    } else {
      await db(env).batch(beginSync(env, importId, now));
    }
  }
  return results.length;
}

/** Deletes every upload of an account (decision 0014), whose rows go with it. */
export async function deleteAccountFiles(env: Env, accountId: string): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `SELECT f.import_id AS importId FROM import_files f
         JOIN import_sources s ON s.import_id = f.import_id WHERE s.account_id = ?`,
    )
    .bind(accountId)
    .all<{ importId: string }>();
  for (const { importId } of results) await dropFile(env, importId);
  return results.length;
}
