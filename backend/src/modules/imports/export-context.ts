import { type ExportContext, repairText, zipPath } from "./export-file.ts";

// What the rest of an export says about its posts file (decision 0127): which media are
// the person's own, which posts were written on someone else's timeline, and which they
// archived. Read by structure, never by a label's words, which follow the export's language.

/** Under the posts file's directory: the lists of the person's own media. */
const OWN_MEDIA = /^(album\/[^/]*|your_uncategorized_photos[^/]*|your_videos[^/]*)\.json$/;
const OTHER_TIMELINES = /^posts_on_other_pages_and_profiles[^/]*\.json$/;
const ARCHIVE = /^archive[^/]*\.json$/;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The file's list: the file itself, or the first list inside its one wrapping object. */
const listOf = (json: unknown): unknown[] => {
  if (Array.isArray(json)) return json;
  const inner = Object.values(record(json) ?? {}).find(Array.isArray);
  return (inner as unknown[] | undefined) ?? [];
};

/** Every `uri` string anywhere in a value; a stack, since a file chooses its own depth. */
function urisIn(json: unknown): string[] {
  const uris: string[] = [];
  const stack = [json];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) stack.push(...(value as unknown[]));
    else {
      for (const [key, inner] of Object.entries(record(value) ?? {})) {
        if (key === "uri" && typeof inner === "string") uris.push(zipPath(inner));
        else if (typeof inner === "object") stack.push(inner);
      }
    }
  }
  return uris;
}

const directoryOf = (name: string) => name.slice(0, name.lastIndexOf("/") + 1);

/** What each entry beside a posts file is, by its path under that file's directory. */
function kindOf(name: string, directories: readonly string[]) {
  const directory = directories.find((d) => name.startsWith(d));
  if (directory === undefined) return null;
  const path = name.slice(directory.length);
  if (OWN_MEDIA.test(path)) return "media" as const;
  if (OTHER_TIMELINES.test(path)) return "timelines" as const;
  return ARCHIVE.test(path) ? ("archive" as const) : null;
}

/** The entries a context reads, out of the ZIP's names and those of its posts files. */
const contextEntries = (names: readonly string[], posts: readonly string[]) => {
  const directories = [...new Set(posts.map(directoryOf))];
  return names.filter((name) => kindOf(name, directories) !== null);
};

const emptyContext = () => ({
  ownMedia: new Set<string>(),
  otherTimelines: new Set<number>(),
  archived: new Map<string, number[]>(),
});

function addArchived(context: ReturnType<typeof emptyContext>, json: unknown): void {
  for (const raw of listOf(json)) {
    const entry = record(raw);
    const seconds = entry?.["timestamp"];
    const labels = entry?.["label_values"];
    if (typeof seconds !== "number" || !Array.isArray(labels)) continue;
    for (const label of labels) {
      const value = record(label)?.["value"];
      if (typeof value !== "string" || value.trim() === "") continue;
      const text = repairText(value).trim();
      context.archived.set(text, [...(context.archived.get(text) ?? []), seconds]);
    }
  }
}

function addTimelines(context: ReturnType<typeof emptyContext>, json: unknown): void {
  for (const raw of listOf(json)) {
    const seconds = record(raw)?.["timestamp"];
    if (typeof seconds === "number") context.otherTimelines.add(seconds);
  }
}

/**
 * The context of an export from its entries beside the posts files. Takes a reader, so
 * that an entry that fails to parse is left out by the one who reads the ZIP.
 */
export async function readContext(
  names: readonly string[],
  posts: readonly string[],
  read: (name: string) => Promise<unknown>,
): Promise<ExportContext> {
  const context = emptyContext();
  const directories = [...new Set(posts.map(directoryOf))];
  for (const name of contextEntries(names, posts)) {
    const json = await read(name);
    const kind = kindOf(name, directories);
    if (kind === "media") for (const uri of urisIn(json)) context.ownMedia.add(uri);
    else if (kind === "timelines") addTimelines(context, json);
    else addArchived(context, json);
  }
  return context;
}
