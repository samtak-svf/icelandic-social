import { withIntegrity } from "spjall-web/integrity";
import { describe, expect, it } from "vitest";

// Subresource Integrity on the page (decisions 0064, 0081): every tag that
// loads a built file carries the hash the build recorded, and the import map
// covers the modules no tag names. HTMLRewriter exists only in workerd, so the
// web's stamping is tested here.

const HASHES = {
  "/assets/main-a1.js": "sha384-main",
  "/assets/route-b2.js": "sha384-route",
  "/assets/app-c3.css": "sha384-style",
  "/assets/core-d4.wasm": "sha384-wasm",
};

function page(body: string, type = "text/html; charset=utf-8") {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">${body}</head><body></body></html>`,
    {
      headers: { "content-type": type },
    },
  );
}

async function stamped(body: string, hashes: Record<string, string> = HASHES) {
  return withIntegrity(page(body), hashes, "n0nce").text();
}

describe("the page's integrity (0081)", () => {
  it("stamps scripts, module preloads and styles with their hash", async () => {
    const html = await stamped(
      '<link rel="stylesheet" href="/assets/app-c3.css"><link rel="modulepreload" href="/assets/route-b2.js"><script type="module" src="/assets/main-a1.js"></script>',
    );
    expect(html).toContain('href="/assets/app-c3.css" integrity="sha384-style"');
    expect(html).toContain('href="/assets/route-b2.js" integrity="sha384-route"');
    expect(html).toContain('src="/assets/main-a1.js" integrity="sha384-main"');
  });

  it("puts an import map with every module's integrity first in head, under the nonce", async () => {
    const html = await stamped("");
    const map = /<head><script type="importmap" nonce="n0nce">(.*?)<\/script>/.exec(html);
    expect(map).not.toBeNull();
    expect(JSON.parse(map![1]!)).toEqual({
      integrity: { "/assets/main-a1.js": "sha384-main", "/assets/route-b2.js": "sha384-route" },
    });
  });

  it("leaves a file the build did not hash alone", async () => {
    const html = await stamped(
      '<script src="/elsewhere.js"></script><link rel="icon" href="/assets/app-c3.css">',
    );
    expect(html).toContain('<script src="/elsewhere.js"></script>');
    expect(html).toContain('<link rel="icon" href="/assets/app-c3.css">');
  });

  it("escapes a path that would end the import map's script", async () => {
    const html = await stamped("", { "/a</script><script>x.js": "sha384-x" });
    expect(html).not.toContain("</script><script>x");
  });

  it("changes nothing that is not a page", async () => {
    const json = page("", "application/json");
    expect(withIntegrity(json, HASHES, "n0nce")).toBe(json);
  });

  it("changes nothing without hashes (the dev server)", async () => {
    const response = page('<script src="/assets/main-a1.js"></script>');
    expect(withIntegrity(response, {}, "n0nce")).toBe(response);
  });
});
