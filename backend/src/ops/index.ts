import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";
import { fail } from "../errors.ts";
import { opsToken } from "../env/index.ts";
import { jobHandlers } from "../job-handlers.ts";
import { log } from "../log.ts";
import { communityExists } from "../modules/communities/index.ts";
import { drainJobs, jobsOverview, retryJobs } from "../modules/jobs/index.ts";
import { commentModeration } from "../modules/moderation/index.ts";
import { restoreSpace } from "../modules/social/index.ts";

// The maintainer's routes (decision 0068): the jobs and the restore of one
// community's space. They are not the apps' API, so they stay out of the
// OpenAPI contract. Each takes the OPS_TOKEN secret as a bearer token, and
// without it, or while the secret is unset, answers as if it did not exist.

const encoder = new TextEncoder();
const digest = async (text: string) => crypto.subtle.digest("SHA-256", encoder.encode(text));

/** Whether `presented` is `token`, compared in constant time over their hashes. */
async function sameToken(presented: string, token: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(presented), digest(token)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const maintainer = createMiddleware<AppEnv>(async (c, next) => {
  const token = opsToken(c.env);
  const presented = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!token || !presented || !(await sameToken(presented, token))) {
    return fail(c, 404, "not_found");
  }
  return next();
});

const Retry = z.union([
  z.object({ jobIds: z.array(z.number().int().positive()).min(1).max(1000) }).strict(),
  z.object({ allFailed: z.literal(true) }).strict(),
]);

const Restore = z
  .object({
    kind: z.literal("space"),
    communityId: z.string().min(1).max(64),
    at: z.iso.datetime({ offset: true }).optional(),
    bookmark: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((r) => (r.at === undefined) !== (r.bookmark === undefined));

/** The most a restore may go back: Durable Object storage keeps 30 days. */
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function body<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data : undefined;
}

export function opsRoutes(app: OpenAPIHono<AppEnv>) {
  app.use("/ops/*", maintainer);

  app.get("/ops/jobs", async (c) => c.json(await jobsOverview(c.env), 200));

  app.post("/ops/jobs/retry", async (c) => {
    const which = await body(c, Retry);
    if (!which) return fail(c, 400, "invalid_request");
    const count = await retryJobs(c.env, which);
    log("ops.jobs_retried", { count, requestId: c.var.requestId });
    return c.json({ retried: count }, 200);
  });

  app.post("/ops/jobs/drain", async (c) => {
    const ran = await drainJobs(c.env, jobHandlers(c.env));
    log("ops.jobs_drained", { count: ran.done, requestId: c.var.requestId });
    return c.json(ran, 200);
  });

  app.post("/ops/restore", async (c) => {
    const input = await body(c, Restore);
    if (!input) return fail(c, 400, "invalid_request");
    const at = input.at === undefined ? undefined : Date.parse(input.at);
    if (at !== undefined && !(at < Date.now() && at > Date.now() - RESTORE_WINDOW_MS)) {
      return fail(c, 400, "invalid_request");
    }
    // A deleted community's space was deleted with it, and is not brought back.
    if (!(await communityExists(c.env, input.communityId))) return fail(c, 404, "not_found");
    const target = at === undefined ? { bookmark: input.bookmark as string } : { at };
    try {
      const moderated = await commentModeration(c.env, input.communityId);
      const restored = await restoreSpace(c.env, input.communityId, target, moderated);
      log("ops.restored", { code: input.kind, requestId: c.var.requestId });
      return c.json(restored, 200);
    } catch (error) {
      // Local workerd has no point-in-time recovery; Cloudflare does. Its
      // history starts a little after the object's first write, so a time
      // close to that is refused as before the object existed.
      const message = error instanceof Error ? error.message : "";
      const code = message.includes("does not implement point-in-time")
        ? "restore_unavailable"
        : message.includes("before this database existed")
          ? "restore_too_early"
          : "internal_error";
      log("ops.restore_failed", { code, requestId: c.var.requestId });
      if (code === "restore_unavailable") return fail(c, 501, code);
      if (code === "restore_too_early") return fail(c, 400, code);
      throw error;
    }
  });
}
