import type { Device, Session } from "./identity/index.ts";

/**
 * What every handler sees: the bindings, the session the request acts in,
 * the device a token resolved to on a route that takes one, and the
 * request's id (decision 0037). Nothing here imports app.ts: the modules
 * that mount their routes on the app take their env from this file.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: { session: Session; device: Device; requestId: string };
};
