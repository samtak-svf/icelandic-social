import { z } from "@hono/zod-openapi";
import { importPage } from "../../env/index.ts";
import { onHost, parsedUrl, type ScrapedItem } from "./scrape.ts";

// The adapter to a platform's official API for the pages a person manages (decision
// 0120). Its addresses, app id, scopes and allowed hosts are in a Worker secret, and
// nothing here runs until that secret and the switch are set. Errors name the step,
// never what was sent; a token travels only in a header or a form body.

const REQUEST_MS = 20_000;
/** The platform's code for a token it no longer accepts. */
const TOKEN_REFUSED = 190;
/** A page counts as the person's only with this task: an analyst or moderator lacks it. */
const OWNER_TASK = "MANAGE";
const MAX_PAGES = 25;

const Config = z.object({
  authorizeUrl: z.url(),
  api: z.url(),
  appId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  /** The grant that swaps a short token for a long one. */
  exchangeGrant: z.string().min(1),
  sourceHosts: z.array(z.string().min(1)).min(1),
  mediaHosts: z.array(z.string().min(1)).min(1),
});

export type PageSettings = z.infer<typeof Config> & { appSecret: string; key: string };

/** The feed's settings, or null while it is switched off or its settings do not parse. */
export function pageSettings(env: Env): PageSettings | null {
  const raw = importPage(env);
  if (!raw) return null;
  try {
    const config = Config.safeParse(JSON.parse(raw.config));
    return config.success ? { ...config.data, appSecret: raw.appSecret, key: raw.key } : null;
  } catch {
    return null;
  }
}

/** The label a stored token is sealed under, and that of the sign-in's cookie. */
export const TOKEN_LABEL = "import page token";
export const FLOW_LABEL = "import page flow";

/** The platform no longer accepts the token: only the person can give a new one. */
export class TokenGone extends Error {}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");

async function answerOf(step: string, response: Response): Promise<Record<string, unknown>> {
  const body = record(await response.json().catch(() => null));
  const error = record(body.error);
  if (error.code === TOKEN_REFUSED) throw new TokenGone(step);
  if (!response.ok || body.error) {
    throw new Error(`page ${step}: ${response.status} ${String(error.code ?? "")}`);
  }
  return body;
}

/** Where the browser goes to sign in at the platform and choose what to grant. */
export function authorizeAddress(settings: PageSettings, redirectUri: string, state: string) {
  const url = new URL(settings.authorizeUrl);
  url.searchParams.set("client_id", settings.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", settings.scopes.join(","));
  return url.href;
}

async function tokenFrom(settings: PageSettings, step: string, form: Record<string, string>) {
  const response = await fetch(`${settings.api}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.appId,
      client_secret: settings.appSecret,
      ...form,
    }),
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const token = text((await answerOf(step, response)).access_token);
  if (!token) throw new Error(`page ${step}: no token`);
  return token;
}

const read = async (settings: PageSettings, step: string, path: string, token: string) =>
  answerOf(
    step,
    await fetch(`${settings.api}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_MS),
    }),
  );

export type ManagedPage = { id: string; name: string; token: string };

/** The pages the person who gave `code` manages, each with a token that does not lapse. */
export async function pagesForCode(
  settings: PageSettings,
  redirectUri: string,
  code: string,
): Promise<ManagedPage[]> {
  const short = await tokenFrom(settings, "code", { code, redirect_uri: redirectUri });
  const long = await tokenFrom(settings, "exchange", {
    grant_type: settings.exchangeGrant,
    [settings.exchangeGrant]: short,
  });
  const fields = "id,name,access_token,tasks";
  const body = await read(
    settings,
    "pages",
    `/me/accounts?fields=${fields}&limit=${MAX_PAGES}`,
    long,
  );
  return list(body.data).flatMap((entry) => {
    const page = record(entry);
    const [id, name, token] = [text(page.id), text(page.name), text(page.access_token)];
    return id && name && token && list(page.tasks).includes(OWNER_TASK)
      ? [{ id, name, token }]
      : [];
  });
}

const POST_FIELDS =
  "id,message,permalink_url,created_time,from," +
  "attachments{media_type,media{image{src}},subattachments{media_type,media{image{src}}}}";

const allowed = (hosts: string[], address: string) => {
  const url = parsedUrl(address);
  return url !== null && onHost(url.hostname, hosts);
};

function itemOf(settings: PageSettings, pageId: string, entry: unknown): ScrapedItem | null {
  const post = record(entry);
  const createdAt = Date.parse(text(post.created_time));
  // The page's own posts only, should the platform ever list a visitor's here.
  if (record(post.from).id !== pageId || Number.isNaN(createdAt)) return null;
  const id = text(post.id).split("_").at(-1);
  if (!id) return null;
  const media = list(record(post.attachments).data).flatMap((a) => [
    record(a),
    ...list(record(record(a).subattachments).data).map(record),
  ]);
  const images = media
    .filter((m) => m.media_type === "photo")
    .map((m) => text(record(record(m.media).image).src))
    .filter((src) => allowed(settings.mediaHosts, src));
  const link = text(post.permalink_url);
  const hasVideo = media.some((m) => m.media_type === "video");
  return {
    id,
    authorId: pageId,
    createdAt,
    body: text(post.message),
    images,
    videoLink: hasVideo && allowed(settings.sourceHosts, link) ? link : null,
  };
}

/** A part of a page's posts, newest first, and where the next part starts; null at the end. */
export async function readPosts(
  settings: PageSettings,
  pageId: string,
  token: string,
  after: string | null,
  count: number,
): Promise<{ items: ScrapedItem[]; after: string | null }> {
  const query = new URLSearchParams({ fields: POST_FIELDS, limit: String(count) });
  if (after) query.set("after", after);
  const path = `/${encodeURIComponent(pageId)}/posts?${query}`;
  const body = await read(settings, "posts", path, token);
  const paging = record(body.paging);
  const next = text(record(paging.cursors).after);
  return {
    items: list(body.data).flatMap((entry) => itemOf(settings, pageId, entry) ?? []),
    after: paging.next && next ? next : null,
  };
}
