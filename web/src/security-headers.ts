// The security headers of every response the web app renders (decision 0062).
//
// Inline scripts are allowed by a nonce minted per request: the only inline
// scripts are Start's own hydration and streaming scripts, which the router
// stamps with `ssr.nonce` (router.tsx). Not 'unsafe-inline', which would bless
// injected script too. No third-party origin appears anywhere: every script,
// style, image and request is this host's own.
//
// 'wasm-unsafe-eval' lets the chat worker compile the core's wasm, and
// nothing else (decision 0081): it allows no eval of JavaScript. The worker
// runs only from this host (worker-src 'self').
//
// style-src keeps 'unsafe-inline' and carries no nonce: a nonce makes browsers
// ignore 'unsafe-inline', and React's `style={}` attributes cannot carry one.
// Inline style cannot run script.

/** A fresh nonce for one response: 128 bits from the CSPRNG, base64. */
export function cspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy for a response whose inline scripts carry `nonce`. `devHost` is
 * the dev server's host, for its HMR socket; never set in a deployed Worker.
 */
function contentSecurityPolicy(nonce: string, devHost?: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    `connect-src 'self'${devHost ? ` ws://${devHost}` : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const HEADERS: Readonly<Record<string, string>> = {
  // No other origin gets a handle on this window, and the app opens no popup
  // that would need one: sign-in is a full navigation (decision 0062).
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
};

/** The response with the security headers and this nonce's policy set. */
export function withSecurityHeaders(response: Response, nonce: string, devHost?: string): Response {
  // A redirect Response's headers are immutable; a copy's are not.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(HEADERS)) out.headers.set(name, value);
  out.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce, devHost));
  return out;
}
