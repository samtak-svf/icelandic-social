// A static server for page/ and vendor/ on one fixed origin, so a browser
// profile reopened later sees the same storage. `/clear` answers with
// `Clear-Site-Data: "storage"`, the header a server can send to wipe a device.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = import.meta.dirname;
const TYPES = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
});

/** @param {string} path */
function fileFor(path) {
  if (path === "/") return join(ROOT, "page", "index.html");
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
  if (rel.startsWith("/vendor/")) return join(ROOT, rel);
  return join(ROOT, "page", rel);
}

/**
 * Serves on 127.0.0.1 and resolves with the origin.
 * @param {number} port
 * @returns {Promise<{ origin: string, close: () => void }>}
 */
export function serve(port) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const headers = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-cache",
    };
    if (path === "/clear") {
      res.writeHead(200, {
        ...headers,
        "Content-Type": "text/html",
        "Clear-Site-Data": '"storage"',
      });
      res.end("<!doctype html><title>cleared</title>");
      return;
    }
    try {
      const file = fileFor(path);
      const body = await readFile(file);
      res.writeHead(200, {
        ...headers,
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404, headers);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({ origin: `http://127.0.0.1:${p}`, close: () => server.close() });
    });
  });
}
