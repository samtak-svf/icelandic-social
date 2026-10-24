import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import hashes from "virtual:spjall-integrity";
import { withIntegrity } from "./integrity.ts";
import { cspNonce, withSecurityHeaders } from "./security-headers.ts";
import type { WebHandler } from "./server-api.d.ts";

const render = createStartHandler(defaultStreamHandler);

/**
 * The web app's answer to a request the API does not own (backend/src/index.ts).
 * The nonce is minted here, once per request: into Start's request context,
 * where the router stamps it on every inline script, and into the header.
 * Every tag that loads a built file gets its `integrity` (./integrity.ts).
 */
export const web: WebHandler = async (request) => {
  const nonce = cspNonce();
  const response = await render(request, { context: { cspNonce: nonce } });
  const devHost = import.meta.env.DEV ? new URL(request.url).host : undefined;
  return withSecurityHeaders(withIntegrity(response, hashes, nonce), nonce, devHost);
};
