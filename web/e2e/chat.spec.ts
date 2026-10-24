import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { WebSocket } from "ws";
import { strings } from "../src/generated/brand/strings.ts";
import { signIn } from "./accounts.ts";
import { DEV, expect, serveOrigin, test, WEB } from "./origin.ts";
import { newGoogleSubject } from "./people.ts";

// A real browser and a phone through the Worker (decisions 0064, 0081). The
// browser runs the core in its worker; the phone is the Rust client in
// core/client/tests/backend.rs (a_phone_links_a_real_browser). The two meet in
// a directory: this side writes `subject` and `code`, the phone writes `ready`
// once its conversation has a message, and its test passes once the
// browser's reply has reached the other account. interop.yml runs it.

test.skip(!process.env.SPJALL_BROWSER_PHONE, "interop.yml runs it beside the phone's half");

const CORE = fileURLToPath(new URL("../../core/", import.meta.url));

/** The phone's half, run as its test; settles with its exit code. */
function phone(dir: string): Promise<number | null> {
  const child = spawn(
    "cargo",
    [
      "test",
      "--locked",
      "-p",
      "spjall-client",
      "--test",
      "backend",
      "a_phone_links_a_real_browser",
      "--",
      "--ignored",
      "--exact",
    ],
    { cwd: CORE, env: { ...process.env, SPJALL_BROWSER_DIR: dir }, stdio: "inherit" },
  );
  return new Promise((resolve) => child.on("exit", resolve));
}

/** What the other side wrote to `name`, once it has. */
async function awaited(dir: string, name: string): Promise<string> {
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
async function serveSocket(page: Page) {
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

test("a phone links this browser, which shows the phone's message and replies", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  const dir = await mkdtemp(join(tmpdir(), "spjall-browser-"));
  const subject = newGoogleSubject();
  const phoneDone = phone(dir);

  await serveSocket(page);
  await signIn(page, "Vafri Prófsson", subject);
  await writeFile(join(dir, "subject"), subject);
  await awaited(dir, "ready");

  // Nothing is linked yet: the page offers the link and shows its code.
  await page.goto(`${WEB}/conversations`);
  await page.getByRole("button", { name: strings.device_link_web_start }).click();
  const code = (await page.locator("code").textContent()) ?? "";
  expect(code).not.toBe("");
  await writeFile(join(dir, "code"), code);

  // The phone approves with its history, and the conversation arrives.
  const conversation = page.getByRole("main").getByRole("listitem").getByRole("link");
  await expect(conversation).toHaveCount(1, { timeout: 120_000 });
  await conversation.click();
  await expect(page.getByText("halló vafri")).toBeVisible();

  await page.getByRole("textbox", { name: strings.composer_placeholder }).fill("svar úr vafra");
  await page.getByRole("button", { name: strings.send }).click();
  await expect(page.getByText("svar úr vafra")).toBeVisible();
  expect(await phoneDone).toBe(0);

  // A second tab of the same browser finds the chat open in the first.
  const second = await page.context().newPage();
  await serveOrigin(second);
  await serveSocket(second);
  await second.goto(`${WEB}/conversations`);
  await expect(
    second.getByRole("status").filter({ hasText: strings.chat_other_tab }),
  ).toBeVisible();
});
