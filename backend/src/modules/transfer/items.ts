import { type Context, Hono } from "hono";
import type { AppEnv } from "../../http.ts";
import { LIMITS } from "../../limits.gen.ts";
import { protocolFail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import {
  type Exporter,
  leftBehind,
  receiveAlbum,
  receivePhoto,
  receivePost,
} from "../imports/index.ts";
import { clientOf, scopeOfVertical } from "./client.ts";
import { capped } from "./fetch.ts";
import { bearerOf } from "./grants.ts";
import { boundaryOf, partsOf } from "./multipart.ts";
import { albumOf, fileOf, postOf } from "./payloads.ts";

// Where an exporter delivers a transfer (decision 0129): POST /dtp/<vertical>, one item
// at a time, under the access token the person's consent issued. The answers are the
// ones the exporter's protocol acts on: invalid_token makes it refresh the token, and
// destination_full pauses the transfer. Nothing here is limited by rate: the exporter
// sends one item at a time and gives up within seconds, so a limit would lose items.

/** The largest JSON item, far above any post. */
const JSON_BYTES = 256 * 1024;
/** The room a file item's description takes beside its bytes. */
const FILE_SLACK = 256 * 1024;

const refuse = protocolFail;

/** The body, read whole within `cap` bytes, or null past it. */
async function bodyOf(c: Context<AppEnv>, cap: number): Promise<Uint8Array | null> {
  const body = c.req.raw.body;
  if (!body) return new Uint8Array();
  if (Number(c.req.header("content-length") ?? 0) > cap) {
    await body.cancel();
    return null;
  }
  return capped(body, cap);
}

const jsonOf = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
};

const done = (c: Context<AppEnv>) => c.json({ status: "ok" }, 200);

async function socialPost(c: Context<AppEnv>, accountId: string, exporter: Exporter) {
  const bytes = await bodyOf(c, JSON_BYTES);
  if (!bytes) return refuse(c, 413, "invalid_request", "the item is too large");
  const post = postOf(jsonOf(bytes));
  if (!post) return refuse(c, 400, "invalid_request", "not a social activity");
  const result = await receivePost(c.env, accountId, exporter, post);
  if (result === "full") return refuse(c, 413, "destination_full");
  log("transfers.post", { accountId, code: result.outcome, count: result.imagesLeftOut });
  return done(c);
}

async function media(c: Context<AppEnv>, accountId: string, exporter: Exporter) {
  const type = c.req.header("content-type") ?? "";
  const boundary = boundaryOf(type);
  if (!boundary) {
    const bytes = await bodyOf(c, JSON_BYTES);
    if (!bytes) return refuse(c, 413, "invalid_request", "the item is too large");
    const album = albumOf(jsonOf(bytes));
    if (!album) return refuse(c, 400, "invalid_request", "not an album");
    await receiveAlbum(c.env, accountId, exporter, album);
    log("transfers.album", { accountId });
    return done(c);
  }
  const bytes = await bodyOf(c, LIMITS.imageBytes + FILE_SLACK);
  // A file past what a photo may be is taken as delivered and left behind, as a video is.
  if (!bytes) {
    await leftBehind(c.env, accountId, exporter);
    log("transfers.left_behind", { accountId });
    return done(c);
  }
  const [described, file] = partsOf(bytes, boundary) ?? [];
  const item = described && fileOf(jsonOf(described.bytes));
  if (!item || !file) return refuse(c, 400, "invalid_request", "not a photo or a video");
  if (item.kind === "Video" || file.bytes.byteLength > LIMITS.imageBytes) {
    await leftBehind(c.env, accountId, exporter);
    log("transfers.left_behind", { accountId });
    return done(c);
  }
  const staged = await receivePhoto(c.env, accountId, exporter, {
    bytes: file.bytes,
    albumId: item.albumId,
    takenAt: item.takenAt ?? Date.now(),
    caption: item.caption,
  });
  if (staged === "full") return refuse(c, 413, "destination_full");
  log("transfers.photo", { accountId, code: staged });
  return done(c);
}

export function itemRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/dtp/:vertical", async (c) => {
    const client = clientOf(c.env);
    if (!client) {
      await c.req.raw.body?.cancel();
      return refuse(c, 404, "not_found");
    }
    const presented = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const bearer = presented ? await bearerOf(c.env, presented) : null;
    if (!bearer || bearer.clientId !== client.id) {
      await c.req.raw.body?.cancel();
      return refuse(c, 401, "invalid_token");
    }
    const scope = scopeOfVertical(c.req.param("vertical"));
    if (!scope) {
      await c.req.raw.body?.cancel();
      return refuse(c, 404, "not_found");
    }
    if (!bearer.scopes.includes(scope)) {
      await c.req.raw.body?.cancel();
      return refuse(c, 403, "insufficient_scope");
    }
    const exporter = { clientId: client.id, source: client.source };
    return scope === "social-posts"
      ? socialPost(c, bearer.accountId, exporter)
      : media(c, bearer.accountId, exporter);
  });

  return app;
}
