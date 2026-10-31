import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  completeImportRoute,
  createImportFileRoute,
  deleteImportRoute,
  getImportRoute,
  listImportItemsRoute,
  publishImportRoute,
  putImportPartRoute,
} from "../../api/imports.ts";
import { withinLimit } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { partRequest } from "../../shared/multipart.ts";
import {
  completeFile,
  createFileImport,
  fileOf,
  publishFile,
  putFilePart,
  removeFile,
} from "./file.ts";
import { itemsOf, statusOf } from "./file-read.ts";

// The routes of a file import (decision 0119). Another person's import answers
// not_found, as an import that does not exist. Log lines carry ids and sizes only.

const STATUS = {
  not_found: 404,
  conflict: 409,
  incomplete: 409,
  expired: 410,
  invalid_request: 400,
} as const;

type Code = keyof typeof STATUS;
type Refusal<K extends Code> = K extends Code ? ReturnType<typeof fail<(typeof STATUS)[K]>> : never;

function refusal<K extends Code>(c: Context<AppEnv>, code: K): Refusal<K> {
  return fail(c, STATUS[code], code) as Refusal<K>;
}

/** The rate limit of the routes that start work, as an upload's: per account. */
async function limited(c: Context<AppEnv>, accountId: string): Promise<boolean> {
  if (await withinLimit(c.env, "photos", accountId)) return false;
  log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
  return true;
}

export function importRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(notSuspended(createImportFileRoute), async (c) => {
    const { accountId } = c.var.session;
    if (await limited(c, accountId)) return fail(c, 429, "rate_limited");
    const created = await createFileImport(c.env, accountId, c.req.valid("json").size);
    if (created === "too_large") return fail(c, 413, "too_large");
    log("imports.started", { accountId });
    return c.json(created, 201);
  });

  app.openapi(putImportPartRoute, async (c) => {
    const { importId, part } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const request = partRequest(c.req.raw);
    if (!request) return refuse(fail(c, 400, "invalid_request"));
    try {
      const { accountId } = c.var.session;
      const stored = await putFilePart(
        c.env,
        accountId,
        importId,
        part,
        request.length,
        request.body,
      );
      if (stored !== "ok") return refuse(refusal(c, stored));
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    return c.body(null, 204);
  });

  app.openapi(completeImportRoute, async (c) => {
    const done = await completeFile(c.env, c.var.session.accountId, c.req.valid("param").importId);
    if (done !== "ok") return refusal(c, done);
    return c.body(null, 204);
  });

  app.openapi(getImportRoute, async (c) => {
    const file = await fileOf(c.env, c.var.session.accountId, c.req.valid("param").importId);
    return file ? c.json(statusOf(file), 200) : fail(c, 404, "not_found");
  });

  app.openapi(listImportItemsRoute, async (c) => {
    const { importId } = c.req.valid("param");
    const file = await fileOf(c.env, c.var.session.accountId, importId);
    if (!file) return fail(c, 404, "not_found");
    return c.json(await itemsOf(c.env, importId, c.req.valid("query").cursor), 200);
  });

  app.openapi(notSuspended(publishImportRoute), async (c) => {
    const { accountId } = c.var.session;
    if (await limited(c, accountId)) return fail(c, 429, "rate_limited");
    const started = await publishFile(
      c.env,
      accountId,
      c.req.valid("param").importId,
      c.req.valid("json"),
    );
    if (started !== "ok") return refusal(c, started);
    log("imports.publish_started", { accountId });
    return c.body(null, 204);
  });

  app.openapi(deleteImportRoute, async (c) => {
    const removed = await removeFile(c.env, c.var.session.accountId, c.req.valid("param").importId);
    if (removed !== "ok") return refusal(c, removed);
    log("imports.removed", { accountId: c.var.session.accountId });
    return c.body(null, 204);
  });
}
