import type { OpenAPIHono } from "@hono/zod-openapi";
import { createExportRoute, getExportFileRoute, listExportsRoute } from "../../api/exports.ts";
import { mediaBucket } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { rangeOf } from "../../shared/range.ts";
import { zipKey } from "./checkpoint.ts";
import { asRead, exportsOf, getExport, startExport } from "./store.ts";

// The routes of a person's own export (decision 0126). No route is wrapped in `notSuspended`: the
// content is the person's own. Another person's export answers not_found. Log lines carry ids only.

const shown = (row: Awaited<ReturnType<typeof getExport>> & object) => ({
  exportId: row.exportId,
  state: row.state,
  failure: row.failure,
  size: row.size,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
});

export function exportRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createExportRoute, async (c) => {
    const { accountId } = c.var.session;
    const started = await startExport(c.env, accountId, Date.now());
    if (!started) return fail(c, 409, "conflict");
    log("exports.started", { accountId });
    return c.json(shown(started), 201);
  });

  app.openapi(listExportsRoute, async (c) => {
    const rows = await exportsOf(c.env, c.var.session.accountId, Date.now());
    return c.json({ exports: rows.map(shown) }, 200);
  });

  app.openapi(getExportFileRoute, async (c) => {
    const { exportId } = c.req.valid("param");
    const now = Date.now();
    const found = await getExport(c.env, exportId);
    if (!found || found.accountId !== c.var.session.accountId) return fail(c, 404, "not_found");
    if (found.expiresAt <= now) return fail(c, 410, "expired");
    const row = asRead(found, now);
    if (row.state !== "ready") return fail(c, 409, "conflict");
    const bucket = mediaBucket(c.env);
    const head = await bucket.head(zipKey(exportId));
    if (!head) return fail(c, 404, "not_found");
    const slice = rangeOf(c.req.header("range"), head.size);
    if (slice === "unsatisfiable") {
      return c.body(null, 416, { "content-range": `bytes */${head.size}` });
    }
    const object = await bucket.get(
      zipKey(exportId),
      slice === "whole" ? undefined : { range: slice },
    );
    if (!object) return fail(c, 404, "not_found");
    const headers = {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="export.zip"',
      "accept-ranges": "bytes",
      etag: head.httpEtag,
      "cache-control": "private, no-store",
    };
    if (slice === "whole") {
      return c.body(object.body, 200, { ...headers, "content-length": String(head.size) });
    }
    return c.body(object.body, 206, {
      ...headers,
      "content-length": String(slice.length),
      "content-range": `bytes ${slice.offset}-${slice.offset + slice.length - 1}/${head.size}`,
    });
  });
}
