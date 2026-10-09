// cloudflare.config.ts resolved the way `cf deploy` resolves it (no mode), as
// plain data for the scripts and the test config that read it. The config
// itself stays the one place each value is written.

import config from "../cloudflare.config.ts";

type Ctx = { mode: string | undefined; isPreview: boolean };

/** The parts of a binding and an export these readers look at. */
export type ResolvedWorker = {
  name: string;
  env: Record<string, { type: string; id?: string; worker?: unknown; exportName?: string }>;
  exports: Record<string, { type: string; storage?: string }>;
};

const resolve = async (value: unknown, ctx: Ctx): Promise<unknown> =>
  typeof value === "function" ? value(ctx) : value;

export async function workerConfig(mode?: string): Promise<ResolvedWorker> {
  const ctx = { mode, isPreview: false };
  const root = (await resolve(config, ctx)) as { worker: unknown };
  const worker = (await resolve(root.worker, ctx)) as Partial<ResolvedWorker> & { name: string };
  return { name: worker.name, env: worker.env ?? {}, exports: worker.exports ?? {} };
}
