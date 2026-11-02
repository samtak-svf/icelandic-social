import { ITEM_CLASSES, type ItemClass } from "../../api/imports.ts";
import { db } from "../../env/index.ts";
import {
  FILE_COLUMNS,
  FILE_FROM,
  type FileRead,
  fileRow,
  type FileRow,
  ITEM_PAGE,
} from "./file.ts";
import type { Lost } from "./file-jobs.ts";

// What the person sees of a file import: where it stands, and the posts the parse
// found, a page at a time, to choose from.

export type FileStatus = {
  state: FileRow["state"] | "removing";
  failure: string | null;
  counts: {
    posts: number;
    images: number;
    videos: number;
    skipped: number;
    earliest: number | null;
    latest: number | null;
  };
  classes: (ClassCount & { class: ItemClass })[];
  lost: Lost;
};

type ClassCount = { posts: number; images: number; imagesLost: number; videos: number };
const NONE: ClassCount = { posts: 0, images: 0, imagesLost: 0, videos: 0 };

export function statusOf(file: FileRow): FileStatus {
  const { posts, images, videos, skipped, earliest, latest } = file;
  const tally = JSON.parse(file.classes) as Partial<Record<ItemClass, ClassCount>>;
  const lost = JSON.parse(file.lost) as Partial<Lost>;
  return {
    state: file.removing ? "removing" : file.state,
    failure: file.failure,
    counts: { posts, images, videos, skipped, earliest, latest },
    classes: ITEM_CLASSES.map((name) => ({ class: name, ...(tally[name] ?? NONE) })),
    lost: {
      videoOnly: 0,
      foreignOnly: 0,
      foreignImages: 0,
      empty: 0,
      videoFiles: 0,
      videoBytes: 0,
      ...lost,
    },
  };
}

/** How many earlier file imports are listed: far more than a person has reason to hold. */
const LISTED = 100;

/**
 * The person's own file imports, newest first, so that one can be found again to remove
 * it long after it was published. A connection's preview is reached from the connection,
 * and an import being removed is already gone as far as they are concerned.
 */
export async function listFiles(
  env: Env,
  accountId: string,
): Promise<(FileStatus & { importId: string; createdAt: number })[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT ${FILE_COLUMNS}, s.created_at AS createdAt ${FILE_FROM}
        WHERE s.account_id = ? AND s.kind = 'file' AND s.removing_at IS NULL
        ORDER BY s.created_at DESC, s.import_id DESC LIMIT ?`,
    )
    .bind(accountId, LISTED)
    .all<FileRead & { createdAt: number }>();
  return results.map((row) => ({
    importId: row.importId,
    createdAt: row.createdAt,
    ...statusOf(fileRow(row)),
  }));
}

export type PreviewItem = {
  id: string;
  at: number;
  text: string;
  images: number;
  hasVideo: boolean;
  class: ItemClass;
};

/** A page of the posts in date order; `next` is the cursor of the page after, or null. */
export async function itemsOf(
  env: Env,
  importId: string,
  cursor: string | undefined,
): Promise<{ items: PreviewItem[]; next: string | null }> {
  const [at = "0", ...rest] = (cursor ?? "").split("-");
  const after = rest.join("-");
  const { results } = await db(env)
    .prepare(
      `SELECT item_id AS id, at, body AS text, json_array_length(images) AS images,
              has_video AS hasVideo, class
         FROM import_file_items
        WHERE import_id = ?1 AND (at > ?2 OR (at = ?2 AND item_id > ?3))
        ORDER BY at, item_id LIMIT ?4`,
    )
    .bind(importId, Number(at), after, ITEM_PAGE + 1)
    .all<Omit<PreviewItem, "hasVideo"> & { hasVideo: number }>();
  const page = results.slice(0, ITEM_PAGE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...row, hasVideo: row.hasVideo === 1 })),
    next: results.length > ITEM_PAGE && last ? `${last.at}-${last.id}` : null,
  };
}
