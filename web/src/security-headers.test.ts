import { describe, expect, it } from "vitest";

import { withSecurityHeaders } from "./security-headers";

const policy = (devHost?: string) =>
  withSecurityHeaders(new Response("x"), "n0nce", devHost).headers.get("Content-Security-Policy") ??
  "";
const directive = (name: string) =>
  policy()
    .split("; ")
    .find((d) => d.startsWith(`${name} `));

describe("the page's content security policy (0062, 0081)", () => {
  it("runs scripts from this host and the nonce, and compiles wasm, with no eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-n0nce' 'wasm-unsafe-eval'");
    expect(policy()).not.toContain("'unsafe-eval'");
  });

  it("runs workers only from this host", () => {
    expect(directive("worker-src")).toBe("worker-src 'self'");
  });

  it("connects only to this host outside the dev server", () => {
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(policy("localhost:8787")).toContain("connect-src 'self' ws://localhost:8787");
  });
});
