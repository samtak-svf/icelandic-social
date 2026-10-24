// Stamps Subresource Integrity on a rendered page (decisions 0064, 0081).
//
// Start writes the page's <script>, <link rel="modulepreload"> and
// <link rel="stylesheet"> tags and offers no hook for `integrity`, so the
// Worker adds it on the way out from the hashes the build recorded
// (web/integrity.ts). Module loads no tag names (the router's dynamic
// `import()` of a route) are covered by an import map's `integrity`, which
// the page carries first in <head>. A file the build did not hash gets no
// attribute: the dev server's modules, which change under it.
//
// HTMLRewriter is the Workers runtime's; the test runs in workerd
// (backend/test/web-integrity.test.ts).

// The part of the Workers runtime's HTMLRewriter used here; the web's types
// are the browser's, which have none.
interface RewriterElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  prepend(content: string, options: { html: boolean }): void;
}
interface ElementHandler {
  element(element: RewriterElement): void;
}
declare class HTMLRewriter {
  on(selector: string, handler: ElementHandler): HTMLRewriter;
  transform(response: Response): Response;
}

/** The SRI value of each built file, by its URL path. */
export type Integrity = Readonly<Record<string, string>>;

/** The import map that names the integrity of every module, as an inline script. */
export function importMap(hashes: Integrity, nonce: string): string {
  const modules = Object.fromEntries(
    Object.entries(hashes).filter(([path]) => /\.m?js$/.test(path)),
  );
  // `<` escaped, so no path can close the script.
  const json = JSON.stringify({ integrity: modules }).replaceAll("<", "\\u003c");
  return `<script type="importmap" nonce="${nonce}">${json}</script>`;
}

/** The page with `integrity` on every tag that loads a hashed file. */
export function withIntegrity(response: Response, hashes: Integrity, nonce: string): Response {
  const html = (response.headers.get("content-type") ?? "").startsWith("text/html");
  if (!html || Object.keys(hashes).length === 0) return response;
  const stamp = (attribute: "src" | "href"): ElementHandler => ({
    element(element) {
      const value = hashes[element.getAttribute(attribute) ?? ""];
      if (value !== undefined) element.setAttribute("integrity", value);
    },
  });
  return new HTMLRewriter()
    .on("head", {
      element(head) {
        head.prepend(importMap(hashes, nonce), { html: true });
      },
    })
    .on("script[src]", stamp("src"))
    .on('link[rel="modulepreload"]', stamp("href"))
    .on('link[rel="stylesheet"]', stamp("href"))
    .transform(response);
}
