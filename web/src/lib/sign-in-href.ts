/**
 * The Google start route that brings the browser back to `href` once signed
 * in, so a link to a community or a post survives signing in. The Worker
 * accepts only a same-origin path as `next`; the hash never reaches it.
 */
export function signInHref(href: string): string {
  const path = href.split("#")[0] || "/";
  return path === "/"
    ? "/auth/google/start"
    : `/auth/google/start?next=${encodeURIComponent(path)}`;
}
