import type { ItemClass } from "../../api/imports.ts";
import { MAX_IMPORTED_IMAGES } from "./core.ts";
import {
  IMAGE,
  idOf,
  listOf,
  MAX_BODY,
  type ParsedItem,
  record,
  repairText,
  zipPath,
} from "./export-file.ts";

// The photos an export holds outside its posts files (decision 0127). A caption makes a post of its
// own and an album's name gathers the rest, so that a thousand photos do not become a thousand posts.

/** One photo in the person's own lists, before it is known whether a post already holds it. */
export type OwnPhoto = {
  path: string;
  seconds: number;
  caption: string;
  /** The album's name and description, or nothing outside an album. */
  title: string;
  class: Extract<ItemClass, "album" | "profile" | "uncategorized">;
};

const ALBUM = /^album\//;
const UNCATEGORIZED = /^your_uncategorized_photos/;
/** The platform's own albums, by the directory their media sits in, which no language changes. */
const PROFILE_MEDIA = /\/(profilepictures|coverphotos)[^/]*\//i;
const DAY = 24 * 60 * 60;

const text = (value: unknown) => (typeof value === "string" ? repairText(value).trim() : "");

/** The album's name, and under it what the person wrote about the album. */
const titleOf = (album: Record<string, unknown> | null) =>
  [text(album?.["name"]), text(album?.["description"])].filter((part) => part !== "").join("\n\n");

/** One entry as a photo, or null when it is not an image with a date. */
function photoOf(raw: unknown, title: string, isAlbum: boolean): OwnPhoto | null {
  const entry = record(raw);
  const uri = entry?.["uri"];
  const seconds = entry?.["creation_timestamp"];
  if (typeof uri !== "string" || !IMAGE.test(uri)) return null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const path = zipPath(uri);
  const kind = PROFILE_MEDIA.test(path) ? "profile" : "album";
  return {
    path,
    seconds,
    caption: text(entry?.["description"]),
    title,
    class: isAlbum ? kind : "uncategorized",
  };
}

/** The photos of one media list, by its path under the posts file's directory. */
export function photosIn(path: string, json: unknown): OwnPhoto[] {
  const isAlbum = ALBUM.test(path);
  if (!isAlbum && !UNCATEGORIZED.test(path)) return [];
  const album = isAlbum ? record(json) : null;
  const list = isAlbum ? album?.["photos"] : listOf(json);
  if (!Array.isArray(list)) return [];
  const title = titleOf(album);
  return list.flatMap((raw) => photoOf(raw, title, isAlbum) ?? []);
}

/** Photos that belong in one post: from one list, of one day, with the same caption or none. */
function gathered(photos: readonly OwnPhoto[], taken: ReadonlySet<string>): OwnPhoto[][] {
  const seen = new Set(taken);
  const groups = new Map<string, OwnPhoto[]>();
  for (const photo of photos) {
    if (seen.has(photo.path)) continue;
    seen.add(photo.path);
    const key = JSON.stringify([
      photo.class,
      photo.title,
      Math.floor(photo.seconds / DAY),
      photo.caption,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }
  return [...groups.values()];
}

const earliestFirst = (a: OwnPhoto, b: OwnPhoto) =>
  a.seconds - b.seconds || (a.path < b.path ? -1 : 1);

/** One post of a group: the photos in order, under the caption, or else the album's name. */
async function postOf(photos: readonly OwnPhoto[]): Promise<ParsedItem> {
  const [first] = photos as [OwnPhoto, ...OwnPhoto[]];
  const at = Math.round(first.seconds) * 1000;
  const body = (first.caption || first.title).slice(0, MAX_BODY);
  return {
    id: await idOf(at, body, first.path),
    at,
    body,
    images: photos.map((photo) => photo.path),
    hasVideo: false,
    class: first.class,
    foreignImages: 0,
    needsImages: first.caption === "",
  };
}

/** The posts these photos become, leaving out each path a post in the file already holds. */
export async function photoPosts(
  photos: readonly OwnPhoto[],
  taken: ReadonlySet<string>,
): Promise<ParsedItem[]> {
  const posts: ParsedItem[] = [];
  for (const group of gathered(photos, taken)) {
    const ordered = group.sort(earliestFirst);
    for (let at = 0; at < ordered.length; at += MAX_IMPORTED_IMAGES) {
      posts.push(await postOf(ordered.slice(at, at + MAX_IMPORTED_IMAGES)));
    }
  }
  return posts;
}
