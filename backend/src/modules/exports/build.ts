import { db, mediaBucket } from "../../env/index.ts";
import { ownProfile } from "../../identity/index.ts";
import { getMaster } from "../../shared/images.ts";
import { log } from "../../shared/log.ts";
import { abortUpload, uploadPart } from "../../shared/multipart.ts";
import { spaceLabels } from "../communities/index.ts";
import { friendList } from "../friends/index.ts";
import { exportPage, exportSpaceIds, type OwnStage, readImage } from "../social/index.ts";
import {
  type Checkpoint,
  checkpointKey,
  type Cursor,
  firstCursor,
  loadCheckpoint,
  saveCheckpoint,
  zipKey,
} from "./checkpoint.ts";
import { commentRecord, imagePath, json, postRecord, reactionRecord, summary } from "./format.ts";
import { buildJob, getExport, markFailed, markReady } from "./store.ts";
import {
  centralDirectory,
  crc32,
  ExportTooBig,
  localEntry,
  MAX_ENTRIES,
  MAX_OFFSET,
} from "./zip-writer.ts";

// One run of an export's build (decision 0126). A run does a bounded amount of work, saves the
// whole state as one checkpoint and writes the next run's job, so a retried run repeats only what
// was not saved and an account of any size stays within one run's subrequests.

export type Limits = {
  /** Reads of storage or of a Space in one run (each is a subrequest; a Worker may make 1000). */
  reads: number;
  /** Wall-clock milliseconds of work in one run, far under the 5 minute lease of a job. */
  ms: number;
  /** Every part but the last is this many bytes; R2 wants them equal and at least 5 MiB. */
  partSize: number;
  /** Parts uploaded in one run, so a run's bytes in flight stay bounded. */
  partsPerRun: number;
  /** Rows in one page of a Space. */
  pageSize: number;
};

export const LIMITS: Limits = {
  reads: 100,
  ms: 60_000,
  partSize: 8 * 1024 * 1024,
  partsPerRun: 4,
  pageSize: 50,
};

export type RunResult = "skipped" | "more" | "ready" | "failed";

const STAGES: OwnStage[] = ["posts", "comments", "reactions", "comment_reactions", "votes"];
const pad = (n: number) => String(n).padStart(4, "0");
const concat = (chunks: Uint8Array[], length: number) => {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

class Build {
  chunks: Uint8Array[] = [];
  length = 0;
  reads = 0;
  sent = 0;
  readonly bucket: R2Bucket;
  readonly env: Env;
  readonly exportId: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly cp: Checkpoint;
  readonly limits: Limits;
  constructor(
    env: Env,
    exportId: string,
    accountId: string,
    createdAt: number,
    cp: Checkpoint,
    tail: Uint8Array,
    limits: Limits,
  ) {
    this.env = env;
    this.exportId = exportId;
    this.accountId = accountId;
    this.createdAt = createdAt;
    this.cp = cp;
    this.limits = limits;
    this.bucket = mediaBucket(env);
    if (tail.length > 0) this.push(tail);
  }

  get cursor() {
    return this.cp.cursor;
  }

  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Sends the first `size` bytes of the tail as the next part. */
  private async part(size: number) {
    const all = concat(this.chunks, this.length);
    const body = all.subarray(0, size);
    const partNumber = this.cp.parts.length + 1;
    const etag = await uploadPart(
      this.bucket,
      zipKey(this.exportId),
      this.cp.uploadId,
      partNumber,
      size,
      new Blob([body]).stream(),
    );
    this.cp.parts.push({ partNumber, etag });
    this.cp.written += size;
    this.chunks = [all.slice(size)];
    this.length -= size;
    this.sent += 1;
  }

  async append(name: string, bytes: Uint8Array) {
    if (this.cp.entries.length >= MAX_ENTRIES - 1) throw new ExportTooBig();
    const offset = this.cp.written + this.length;
    if (offset + bytes.length + name.length + 30 > MAX_OFFSET) throw new ExportTooBig();
    const crc = crc32(bytes);
    this.cp.entries.push({ name, crc, size: bytes.length, offset });
    this.push(localEntry(name, bytes, crc));
    while (this.length >= this.limits.partSize) await this.part(this.limits.partSize);
  }

  room(started: number) {
    return (
      this.reads < this.limits.reads &&
      Date.now() - started < this.limits.ms &&
      this.sent < this.limits.partsPerRun
    );
  }

  tail() {
    return concat(this.chunks, this.length);
  }

  /** Writes export.json, the directory and the last parts, and completes the upload. */
  async finish(): Promise<number> {
    const { cp } = this;
    await this.append(
      "export.json",
      json(summary(this.exportId, this.accountId, this.createdAt, cp.cursor.counts)),
    );
    const directory = centralDirectory(cp.entries, cp.written + this.length);
    this.push(directory);
    while (this.length >= this.limits.partSize) await this.part(this.limits.partSize);
    if (this.length > 0) await this.part(this.length);
    await this.bucket
      .resumeMultipartUpload(zipKey(this.exportId), cp.uploadId)
      .complete(cp.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
    return cp.written;
  }

  /** One unit of the walk: the cursor moves only when the unit is in the buffer. */
  async step() {
    const c: Cursor = this.cursor;
    if (c.step === "profile") await this.profile(c);
    else if (c.step === "photo") await this.photo(c);
    else if (c.step === "friends") await this.friends(c);
    else if (c.step === "spaces") await this.listSpaces(c);
    else if (c.step === "space") await this.space(c, this.limits);
  }

  private async profile(c: Cursor) {
    this.reads += 1;
    const p = await ownProfile(this.env, this.accountId);
    await this.append(
      "profile.json",
      json({
        display_name: p?.displayName ?? null,
        bio: p?.bio ?? null,
        created_at: p ? new Date(p.createdAt).toISOString() : null,
        created_at_ms: p?.createdAt ?? null,
        has_photo: p?.hasPhoto ?? false,
      }),
    );
    c.step = "photo";
  }

  private async photo(c: Cursor) {
    this.reads += 1;
    const photo = await getMaster(this.env, this.accountId);
    if (photo) {
      await this.append("profile/photo.webp", new Uint8Array(await photo.arrayBuffer()));
      c.counts.images += 1;
    }
    c.step = "friends";
  }

  private async friends(c: Cursor) {
    this.reads += 1;
    const { friends } = await friendList(this.env, this.accountId, { sort: "newest" });
    await this.append(
      "friends.json",
      json(
        friends.map((f) => ({
          name: f.person.name,
          since: new Date(f.since).toISOString(),
          since_ms: f.since,
        })),
      ),
    );
    c.counts.friends = friends.length;
    c.step = "spaces";
  }

  private async listSpaces(c: Cursor) {
    this.reads += 2;
    const ids = await exportSpaceIds(this.env, this.accountId);
    const labels = await spaceLabels(this.env, ids);
    c.spaces = ids.map((spaceId) => ({
      spaceId,
      kind: labels.get(spaceId)?.kind ?? "unavailable",
      name: labels.get(spaceId)?.name ?? null,
    }));
    c.counts.spaces = ids.length;
    c.step = "space";
    c.space = 0;
    c.stage = "meta";
  }

  private async space(c: Cursor, limits: Limits) {
    const { env, accountId } = this;
    const queued = c.queue[0];
    if (queued) {
      this.reads += 1;
      const object = await readImage(env, queued.spaceId, queued.mediaId);
      if (object) {
        await this.append(
          imagePath(queued.spaceId, queued.mediaId),
          new Uint8Array(await object.arrayBuffer()),
        );
        c.counts.images += 1;
      } else {
        c.counts.images_withheld += 1;
      }
      c.queue.shift();
      return;
    }
    const s = c.spaces[c.space];
    if (!s) {
      c.step = "finish";
      return;
    }
    const dir = `spaces/${s.spaceId}`;
    if (c.stage === "meta") {
      await this.append(`${dir}/space.json`, json({ id: s.spaceId, kind: s.kind, name: s.name }));
      c.stage = "posts";
      c.after = null;
      c.files = { posts: 1, comments: 1, reactions: 1 };
      return;
    }
    this.reads += 1;
    const stage = c.stage as OwnStage;
    const page = await exportPage(env, s.spaceId, accountId, stage, c.after ?? "", limits.pageSize);
    if (stage === "posts" && page.posts.length > 0) {
      await this.append(
        `${dir}/posts-${pad(c.files.posts++)}.json`,
        json(page.posts.map((p) => postRecord(s.spaceId, p))),
      );
      c.counts.posts += page.posts.length;
      this.queueImages(
        c,
        s.spaceId,
        page.posts.flatMap((p) => p.images),
      );
    } else if (stage === "comments" && page.comments.length > 0) {
      await this.append(
        `${dir}/comments-${pad(c.files.comments++)}.json`,
        json(page.comments.map((m) => commentRecord(s.spaceId, m))),
      );
      c.counts.comments += page.comments.length;
      this.queueImages(
        c,
        s.spaceId,
        page.comments.flatMap((m) => m.images),
      );
    } else if (stage !== "posts" && stage !== "comments" && page.reactions.length > 0) {
      await this.append(
        `${dir}/reactions-${pad(c.files.reactions++)}.json`,
        json(page.reactions.map((r) => reactionRecord(stage, r))),
      );
      c.counts.reactions += page.reactions.length;
    }
    if (page.next !== null) {
      c.after = page.next;
      return;
    }
    c.after = null;
    const next = STAGES[STAGES.indexOf(stage) + 1];
    if (next) {
      c.stage = next;
    } else {
      c.space += 1;
      c.stage = "meta";
    }
  }

  private queueImages(
    c: Cursor,
    spaceId: string,
    images: { mediaId: string; withheld: boolean }[],
  ) {
    for (const image of images) {
      if (image.withheld) c.counts.images_withheld += 1;
      else c.queue.push({ spaceId, mediaId: image.mediaId });
    }
  }
}

async function fail(env: Env, exportId: string, code: string, uploadId: string | null) {
  if (uploadId) await abortUpload(mediaBucket(env), zipKey(exportId), uploadId);
  await mediaBucket(env).delete(checkpointKey(exportId));
  await markFailed(env, exportId, code);
  log("exports.failed", { code });
}

type Resumed = { checkpoint: Checkpoint; tail: Uint8Array };

/** Where run `run` starts: a result when there is nothing to build, else the checkpoint to build on. */
async function resume(
  env: Env,
  exportId: string,
  run: number,
  now: number,
): Promise<RunResult | Resumed> {
  const bucket = mediaBucket(env);
  const done = await bucket.head(zipKey(exportId));
  if (done) {
    await bucket.delete(checkpointKey(exportId));
    await markReady(env, exportId, done.size, now);
    return "ready";
  }
  const saved = await loadCheckpoint(env, exportId);
  if (!saved && run !== 1) {
    await fail(env, exportId, "lost", null);
    return "failed";
  }
  if (saved && saved.checkpoint.run > run) {
    await db(env).batch([buildJob(env, exportId, saved.checkpoint.run)]);
    return "skipped";
  }
  if (saved) return saved;
  const checkpoint: Checkpoint = {
    uploadId: (await bucket.createMultipartUpload(zipKey(exportId))).uploadId,
    run,
    parts: [],
    written: 0,
    entries: [],
    cursor: firstCursor(),
  };
  return { checkpoint, tail: new Uint8Array() };
}

/**
 * Runs run `run` of the build of `exportId`. Run twice it has one effect: a finished file is
 * only marked ready, a job for a run the checkpoint has left behind hands over to the
 * checkpoint's run, and a part sent twice replaces itself.
 */
export async function runExportBuild(
  env: Env,
  exportId: string,
  run: number,
  limits: Limits = LIMITS,
  now = Date.now(),
): Promise<RunResult> {
  const row = await getExport(env, exportId);
  if (!row || row.state !== "building") return "skipped";
  const resumed = await resume(env, exportId, run, now);
  if (typeof resumed === "string") return resumed;
  const { checkpoint, tail } = resumed;
  const bucket = mediaBucket(env);
  const build = new Build(env, exportId, row.accountId, row.createdAt, checkpoint, tail, limits);
  const started = Date.now();
  try {
    while (build.cursor.step !== "finish") {
      if (!build.room(started)) {
        checkpoint.run = run + 1;
        await saveCheckpoint(env, exportId, checkpoint, build.tail());
        await db(env).batch([buildJob(env, exportId, run + 1)]);
        return "more";
      }
      await build.step();
    }
    const size = await build.finish();
    await bucket.delete(checkpointKey(exportId));
    await markReady(env, exportId, size, now);
    log("exports.ready", { count: checkpoint.entries.length });
    return "ready";
  } catch (error) {
    if (error instanceof ExportTooBig) {
      await fail(env, exportId, error.code, checkpoint.uploadId);
      return "failed";
    }
    throw error;
  }
}
