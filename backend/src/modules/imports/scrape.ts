import { z } from "@hono/zod-openapi";
import { MAX_SOCIAL_UPLOAD } from "../../api/social.ts";
import { importScrape } from "../../env/index.ts";

// The adapter to the scraping provider of decision 0120, which the public repo does
// not name: its address, its actor, the hosts it may read and what it charges are in
// a Worker secret, and nothing here runs until that secret and the switch are set.

const REQUEST_MS = 20_000;
const MICROS = 1_000_000;

const Config = z.object({
  api: z.url(),
  actor: z.string().min(1),
  sourceHosts: z.array(z.string().min(1)).min(1),
  mediaHosts: z.array(z.string().min(1)).min(1),
  usdPerPost: z.number().positive(),
  usdPerRun: z.number().min(0),
});

export type ScrapeSettings = z.infer<typeof Config> & {
  token: string;
  monthlyCapMicros: number;
};

/** The provider's settings; null while the feed is switched off or not fully set. */
export function scrapeSettings(env: Env): ScrapeSettings | null {
  const raw = importScrape(env);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.config);
  } catch {
    return null;
  }
  const config = Config.safeParse(parsed);
  if (!config.success) return null;
  return {
    ...config.data,
    token: raw.token,
    monthlyCapMicros: Math.round(raw.monthlyCapUsd * MICROS),
  };
}

export const onHost = (host: string, hosts: string[]) =>
  hosts.some((h) => host === h || host.endsWith(`.${h}`));

export function parsedUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

/** The address of a public profile, without what follows it; null when it is not one. */
export function profileAddress(settings: ScrapeSettings, input: string): string | null {
  const url = parsedUrl(input.trim());
  if (!url || !onHost(url.hostname, settings.sourceHosts) || url.pathname === "/") return null;
  const id = url.searchParams.get("id");
  url.search = id ? `?id=${encodeURIComponent(id)}` : "";
  url.hash = "";
  return url.toString();
}

/** The most a run reading `limit` posts can cost, in millionths of a dollar. */
export const runCeiling = (settings: ScrapeSettings, limit: number) =>
  Math.round((settings.usdPerRun + limit * settings.usdPerPost) * MICROS);

async function call(settings: ScrapeSettings, path: string, init: RequestInit = {}) {
  const response = await fetch(`${settings.api}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${settings.token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  // The status only: the answer may quote the input.
  if (!response.ok) throw new Error(`scrape provider answered ${response.status}`);
  return (await response.json()) as unknown;
}

const Run = z.object({
  data: z.object({
    id: z.string(),
    status: z.string(),
    defaultDatasetId: z.string(),
    usageTotalUsd: z.number().optional(),
  }),
});

export type RunState = {
  runId: string;
  datasetId: string;
  state: "running" | "done" | "failed";
  /** The provider's figure; zero until it has come through. */
  micros: number;
};

function runState(answer: unknown): RunState {
  const { data } = Run.parse(answer);
  const state =
    data.status === "SUCCEEDED"
      ? "done"
      : ["READY", "RUNNING"].includes(data.status)
        ? "running"
        : "failed";
  return {
    runId: data.id,
    datasetId: data.defaultDatasetId,
    state,
    micros: Math.round((data.usageTotalUsd ?? 0) * MICROS),
  };
}

/** Starts a run over the newest `limit` posts, which the provider stops at its ceiling. */
export async function startRun(
  settings: ScrapeSettings,
  input: { url: string; limit: number; since: number | null },
): Promise<RunState> {
  const query = new URLSearchParams({
    maxItems: String(input.limit),
    maxTotalChargeUsd: String(runCeiling(settings, input.limit) / MICROS),
  });
  const body = {
    startUrls: [{ url: input.url }],
    resultsLimit: input.limit,
    ...(input.since !== null && {
      onlyPostsNewerThan: new Date(input.since).toISOString().slice(0, 10),
    }),
  };
  return runState(
    await call(settings, `/acts/${settings.actor}/runs?${query}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export const readRun = async (settings: ScrapeSettings, runId: string) =>
  runState(await call(settings, `/actor-runs/${runId}`));

/** A post as the provider gives it, reduced to what the import uses. */
export type ScrapedItem = {
  id: string;
  authorId: string;
  createdAt: number;
  body: string;
  images: string[];
  /** The address of the original, for a post with a video, which does not come over. */
  videoLink: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The image of one media entry; an album's leading entry and a video have none. */
function imageOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  const e = record(entry);
  if (e.is_playable === true) return null;
  const found =
    text(record(e.photo_image).uri) ||
    text(record(e.image).uri) ||
    text(e.image) ||
    text(e.thumbnail);
  return found || null;
}

/** The provider's error for a run that found no posts. */
const NOTHING_FOUND = "no_items";

type ScrapeAnswer = "posts" | "empty" | "failed";

/** One post of the provider's answer; null when it lacks what an import needs. */
function scrapedItem(settings: ScrapeSettings, raw: unknown): ScrapedItem | null {
  const item = record(raw);
  const id = text(item.postId);
  const authorId = text(record(item.user).id);
  const createdAt =
    typeof item.timestamp === "number" ? item.timestamp * 1000 : Date.parse(text(item.time));
  if (!id || !authorId || !Number.isFinite(createdAt)) return null;
  const media = Array.isArray(item.media) ? item.media : [];
  const images = media
    .map(imageOf)
    .filter((url): url is string => url !== null)
    .filter((url) => {
      const parsed = parsedUrl(url);
      return parsed !== null && onHost(parsed.hostname, settings.mediaHosts);
    });
  const hasVideo =
    item.isVideo === true || media.some((entry) => record(entry).is_playable === true);
  const link = parsedUrl(text(item.url));
  return {
    id,
    authorId,
    createdAt,
    body: text(item.text),
    images: [...new Set(images)],
    videoLink: hasVideo && link && onHost(link.hostname, settings.sourceHosts) ? link.href : null,
  };
}

/**
 * What one part of an answer says of the profile. The provider gives the same `empty` for
 * a profile with nothing new and one it could not read, so it proves nothing about either.
 */
function answerOf(rows: unknown[], items: ScrapedItem[]): ScrapeAnswer {
  if (items.length > 0) return "posts";
  return rows.every((row) => record(row).error === NOTHING_FOUND) ? "empty" : "failed";
}

/** `count` posts of a finished run from `offset` on, and how many entries were read. */
export async function readItems(
  settings: ScrapeSettings,
  datasetId: string,
  offset: number,
  count: number,
): Promise<{ items: ScrapedItem[]; read: number; answer: ScrapeAnswer }> {
  const query = new URLSearchParams({
    clean: "true",
    offset: String(offset),
    limit: String(count),
  });
  const answer = await call(settings, `/datasets/${datasetId}/items?${query}`);
  if (!Array.isArray(answer)) return { items: [], read: 0, answer: "failed" };
  const items = answer
    .map((row) => scrapedItem(settings, row))
    .filter((item): item is ScrapedItem => item !== null);
  return { items, read: answer.length, answer: answerOf(answer, items) };
}

/**
 * Loads an image from the provider's media hosts, following no redirect. One that is
 * gone or too big comes back empty, which the upload refuses as no image, so the post
 * comes in without it; a failure that may pass throws, for the job's retry.
 */
export async function loadImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  if (response.status >= 500) throw new Error(`image host answered ${response.status}`);
  const nothing = new Uint8Array();
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return nothing;
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_SOCIAL_UPLOAD) {
    await response.body.cancel();
    return nothing;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > MAX_SOCIAL_UPLOAD ? nothing : bytes;
}

/** A post read from a source, as the core takes it; its images are fetched when asked for. */
export function sourcePost(item: ScrapedItem) {
  return {
    id: item.id,
    createdAt: item.createdAt,
    body: item.body,
    images: item.images.map((url) => () => loadImage(url)),
    link: item.videoLink ?? undefined,
  };
}
