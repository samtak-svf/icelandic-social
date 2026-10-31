import { db, mediaBucket } from "../../env/index.ts";
import { MAX_SOCIAL_UPLOAD } from "../../api/social.ts";
import { log } from "../../shared/log.ts";
import { type Handler, job } from "../jobs/index.ts";
import { deleteBytes, importPost, keyOf, type ImportSource } from "./core.ts";
import { type ParsedItem, parseExportFile, POSTS_FILE } from "./export-file.ts";
import { beginSync, PARSE, PUBLISH } from "./file.ts";
import { r2Source, readDirectory, readEntry, type ZipEntry, ZipError } from "./zip.ts";

// The two jobs of a file import: the parse, which reads the ZIP into preview rows,
// and the publish, which brings the chosen posts in a few at a time.

/**
 * What one posts file may inflate to. A Worker holds it as bytes, text and parsed
 * objects at once, so a larger one is refused with a code rather than ending the
 * isolate; the export splits a long history across several files.
 */
const MAX_JSON = 32 * 1024 * 1024;
/** Preview rows written in one D1 batch. */
const INSERT_BATCH = 50;
/** Posts one publish run brings in, within a run's subrequests. */
const PUBLISHED_PER_RUN = 20;

const basename = (name: string) => name.slice(name.lastIndexOf("/") + 1);

const insertItem = (env: Env, importId: string, item: ParsedItem) =>
  db(env)
    .prepare(
      `INSERT OR IGNORE INTO import_file_items (import_id, item_id, at, body, images, has_video)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      importId,
      item.id,
      item.at,
      item.body,
      JSON.stringify(item.images),
      item.hasVideo ? 1 : 0,
    );

/** The preview rows are all written: the import shows what it holds, to choose from. */
export const previewReady = (env: Env, importId: string, skipped: number) =>
  db(env)
    .prepare(
      `UPDATE import_files SET state = 'ready', skipped = ?2,
              (posts, images, videos, earliest, latest) =
                (SELECT COUNT(*), COALESCE(SUM(json_array_length(images)), 0),
                        COALESCE(SUM(has_video), 0), MIN(at), MAX(at)
                   FROM import_file_items WHERE import_id = ?1)
        WHERE import_id = ?1 AND state = 'parsing'`,
    )
    .bind(importId, skipped);

/** Marks the parse failed with a code, and drops the bytes: nothing will read them. */
async function failParse(env: Env, importId: string, failure: string): Promise<void> {
  await mediaBucket(env).delete(keyOf(importId));
  await db(env)
    .prepare(
      "UPDATE import_files SET state = 'failed', failure = ? WHERE import_id = ? AND state = 'parsing'",
    )
    .bind(failure, importId)
    .run();
  log("imports.parse_failed", { code: failure });
}

async function parseFile(env: Env, importId: string): Promise<void> {
  const head = await mediaBucket(env).head(keyOf(importId));
  if (!head) return failParse(env, importId, "truncated");
  const source = r2Source(mediaBucket(env), keyOf(importId), head.size);
  const posts = (await readDirectory(source)).filter((e) => POSTS_FILE.test(basename(e.name)));
  if (posts.length === 0) return failParse(env, importId, "no_posts");
  let skipped = 0;
  for (const entry of posts) {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(await readEntry(source, entry, MAX_JSON)));
    } catch (error) {
      // A size or archive failure ends the parse; a file that is not JSON is one skipped.
      if (error instanceof ZipError) throw error;
      skipped++;
      continue;
    }
    const parsed = await parseExportFile(json);
    skipped += parsed.skipped;
    for (let at = 0; at < parsed.items.length; at += INSERT_BATCH) {
      await db(env).batch(
        parsed.items.slice(at, at + INSERT_BATCH).map((item) => insertItem(env, importId, item)),
      );
    }
  }
  await previewReady(env, importId, skipped).run();
}

const parse: Handler = async (env, _key, payload) => {
  const { importId } = payload as { importId: string };
  const file = await db(env)
    .prepare("SELECT state FROM import_files WHERE import_id = ?")
    .bind(importId)
    .first<{ state: string }>();
  if (file?.state !== "parsing") return;
  try {
    await parseFile(env, importId);
  } catch (error) {
    // An archive this reader refuses will be refused again; anything else is retried.
    if (!(error instanceof ZipError)) throw error;
    await failParse(env, importId, error.code);
  }
};

/** Everything is brought in: the bytes go, then the preview rows, then the state. */
async function finish(env: Env, importId: string): Promise<void> {
  await deleteBytes(env, importId);
  await db(env).batch([
    ...beginSync(env, importId, Date.now()),
    db(env).prepare("DELETE FROM import_file_items WHERE import_id = ?").bind(importId),
    db(env)
      .prepare(
        "UPDATE import_files SET state = 'done' WHERE import_id = ? AND state = 'publishing'",
      )
      .bind(importId),
  ]);
  log("imports.file_published", {});
}

type Chosen = {
  id: string;
  at: number;
  body: string;
  images: string;
  hasVideo: number;
  link: string | null;
};

/** The image loaders of a post: those whose entry is in the ZIP, and within what a post takes. */
function loadersOf(
  source: ReturnType<typeof r2Source>,
  entries: Map<string, ZipEntry>,
  paths: string[],
) {
  return paths.flatMap((path) => {
    const entry = entries.get(path);
    if (!entry || entry.size > MAX_SOCIAL_UPLOAD) return [];
    // An entry that fails to read yields no bytes, which the upload refuses as no image.
    return [() => readEntry(source, entry, MAX_SOCIAL_UPLOAD).catch(() => new Uint8Array())];
  });
}

/** The image loaders of a file: a post's images are paths in the ZIP. */
async function zipImages(env: Env, importId: string) {
  const head = await mediaBucket(env).head(keyOf(importId));
  if (!head) throw new Error(`import ${importId}: the upload is gone`);
  const source = r2Source(mediaBucket(env), keyOf(importId), head.size);
  const entries = new Map((await readDirectory(source)).map((e) => [e.name, e]));
  return (paths: string[]) => loadersOf(source, entries, paths);
}

/** The image loaders of a connection's preview: a post's images are keys in the bucket. */
const storedImages = (env: Env) => (keys: string[]) =>
  keys.map((key) => async () => {
    const stored = await mediaBucket(env).get(key);
    return stored ? new Uint8Array(await stored.arrayBuffer()) : new Uint8Array();
  });

const publish: Handler = async (env, _key, payload) => {
  const { importId, part } = payload as { importId: string; part: number };
  const row = await db(env)
    .prepare(
      `SELECT s.account_id AS accountId, s.kind, s.source, s.audience, f.from_at AS fromAt,
              f.to_at AS toAt, f.excluded
         FROM import_files f JOIN import_sources s ON s.import_id = f.import_id
        WHERE f.import_id = ? AND f.state = 'publishing' AND s.removing_at IS NULL`,
    )
    .bind(importId)
    .first<{
      accountId: string;
      kind: string;
      source: string;
      audience: "friends" | "everyone";
      fromAt: number | null;
      toAt: number | null;
      excluded: string;
    }>();
  if (!row) return;
  const { results } = await db(env)
    .prepare(
      `SELECT item_id AS id, at, body, images, has_video AS hasVideo, link
         FROM import_file_items
        WHERE import_id = ?1 AND published = 0
          AND (?2 IS NULL OR at >= ?2) AND (?3 IS NULL OR at <= ?3)
          AND item_id NOT IN (SELECT value FROM json_each(?4))
        ORDER BY at, item_id LIMIT ?5`,
    )
    .bind(importId, row.fromAt, row.toAt, row.excluded, PUBLISHED_PER_RUN)
    .all<Chosen>();
  if (results.length === 0) return finish(env, importId);

  const imagesOf = row.kind !== "file" ? storedImages(env) : await zipImages(env, importId);
  const owner: ImportSource = {
    importId,
    accountId: row.accountId,
    source: row.source,
    audience: row.audience,
  };
  for (const item of results) {
    const done = await importPost(
      env,
      owner,
      {
        id: item.id,
        createdAt: item.at,
        body: item.body,
        images: imagesOf(JSON.parse(item.images) as string[]),
        link: item.link ?? undefined,
      },
      "backlog",
    );
    // A removal began: nothing more comes in, and the removal takes what did.
    if (done.outcome === "stopped") return;
  }
  const next = job(env, {
    kind: PUBLISH,
    key: `${PUBLISH}:${importId}:${part + 1}`,
    payload: { importId, part: part + 1 },
  });
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE import_file_items SET published = 1
          WHERE import_id = ? AND item_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(importId, JSON.stringify(results.map((r) => r.id))),
    ...(results.length === PUBLISHED_PER_RUN ? [next] : []),
  ]);
  // A short run was the last: the next one would find nothing, so finish here.
  if (results.length < PUBLISHED_PER_RUN) await finish(env, importId);
};

/** The handlers of the file import's jobs. */
export const fileJobHandlers = (): Record<string, Handler> => ({
  [PARSE]: parse,
  [PUBLISH]: publish,
});
