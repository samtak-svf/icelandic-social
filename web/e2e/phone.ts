import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { WebSocket } from "ws";
import { DEV, expect, WEB } from "./origin.ts";

// What the specs that meet a phone share: the phone's half, run as a Rust test
// of core/client/tests/browser.rs, the files the two sides pass each other in
// a directory, and the page's socket carried to `cf dev`.

const CORE = fileURLToPath(new URL("../../core/", import.meta.url));

/** The phone's half, the Rust test `test` of core/client/tests/browser.rs; settles with its exit code. */
export function phone(dir: string, test: string): Promise<number | null> {
  const child = spawn(
    "cargo",
    [
      "test",
      "--locked",
      "-p",
      "spjall-client",
      "--test",
      "browser",
      test,
      "--",
      "--ignored",
      "--exact",
    ],
    { cwd: CORE, env: { ...process.env, SPJALL_BROWSER_DIR: dir }, stdio: "inherit" },
  );
  return new Promise((resolve) => child.on("exit", resolve));
}

/** What the other side wrote to `name`, once it has. */
export async function awaited(dir: string, name: string): Promise<string> {
  const read = () => readFile(join(dir, name), "utf8").catch(() => "");
  await expect.poll(read, { timeout: 180_000 }).not.toBe("");
  return read();
}

/**
 * The page's socket goes to `cf dev` as the web's origin. Routing covers
 * requests but not sockets, and connecting the route to its server would
 * reach the real host, so the route opens its own socket with the cookie the
 * browser holds and the Origin the Worker checks (credentials.ts).
 */
export async function serveSocket(page: Page) {
  await page.routeWebSocket(/\/v1\/ws/, async (route) => {
    const url = new URL(route.url());
    const cookies = await page.context().cookies(WEB);
    const server = new WebSocket(`${DEV.replace(/^http/, "ws")}${url.pathname}${url.search}`, {
      headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "), origin: WEB },
    });
    const early: string[] = [];
    server.on("open", () => {
      for (const frame of early.splice(0)) server.send(frame);
    });
    route.onMessage((frame) => {
      const text = typeof frame === "string" ? frame : frame.toString();
      if (server.readyState === WebSocket.OPEN) server.send(text);
      else early.push(text);
    });
    server.on("message", (data: Buffer) => route.send(data.toString()));
    // 1005 and 1006 only describe a close; neither may be sent.
    server.on("close", (code, reason) =>
      route.close({ code: code === 1005 || code === 1006 ? 1000 : code, reason: String(reason) }),
    );
    server.on("error", () => void route.close());
    route.onClose(() => server.close());
  });
}
