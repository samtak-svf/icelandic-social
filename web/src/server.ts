import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { cspNonce, withSecurityHeaders } from "./security-headers.ts";
import type { WebHandler } from "./server-api.d.ts";

const render = createStartHandler(defaultStreamHandler);

/**
 * The web app's answer to a request the API does not own (backend/src/index.ts).
 * The nonce is minted here, once per request: into Start's request context,
 * where the router stamps it on every inline script, and into the header.
 */
export const web: WebHandler = async (request) => {
  const nonce = cspNonce();
  const response = await render(request, { context: { cspNonce: nonce } });
  const devHost = import.meta.env.DEV ? new URL(request.url).host : undefined;
  return withSecurityHeaders(response, nonce, devHost);
};
