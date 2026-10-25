import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { WebSocket } from "ws";
import { strings } from "../src/generated/brand/strings.ts";
import { layoutOf } from "../src/ui/layout.ts";
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

/** The id of the linked browser among the devices `/v1/me` lists. */
function browserDevice(me: unknown): string | undefined {
  if (typeof me !== "object" || me === null || !("devices" in me) || !Array.isArray(me.devices))
    return undefined;
  for (const d of me.devices as unknown[]) {
    if (typeof d === "object" && d !== null && "kind" in d && d.kind === "web") {
      if ("deviceId" in d && typeof d.deviceId === "string") return d.deviceId;
    }
  }
  return undefined;
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
  await expect(page.getByText("halló vafri", { exact: true })).toBeVisible();
  // An expanded window keeps the list beside the open conversation (0093).
  const beside = layoutOf(page.viewportSize()!.width).conversations === "list-and-thread";
  await expect(conversation).toHaveCount(beside ? 1 : 0);
  await expect(page.getByRole("link", { name: strings.back })).toHaveCount(beside ? 0 : 1);

  await page.getByRole("textbox", { name: strings.composer_placeholder }).fill("svar úr vafra");
  await page.getByRole("button", { name: strings.send }).click();
  await expect(page.getByText("svar úr vafra", { exact: true })).toBeVisible();
  expect(await phoneDone).toBe(0);

  // A second tab of the same browser finds the chat open in the first.
  const second = await page.context().newPage();
  await serveOrigin(second);
  await serveSocket(second);
  await second.goto(`${WEB}/conversations`);
  await expect(
    second.getByRole("status").filter({ hasText: strings.chat_other_tab }),
  ).toBeVisible();

  // Another session of the same account revokes this browser's device (#156).
  // The server closes the socket with 4401, and the page, without a reload,
  // ends the session at once rather than reconnecting with backoff.
  await second.close();
  await page.goBack();
  await expect(conversation).toHaveCount(1);
  // The row says who said the last thing: here the reader.
  await expect(conversation).toContainText(strings.last_line_own({ text: "svar úr vafra" }));
  const other = await page.context().browser()!.newContext();
  const elsewhere = await other.newPage();
  await serveOrigin(elsewhere);
  await signIn(elsewhere, "Vafri Prófsson", subject);
  const headers = { "spjall-client": "web/0.1.0" };
  const mine: unknown = await elsewhere.evaluate(async (h) => {
    const body: unknown = await (await fetch("/v1/me", { headers: h })).json();
    return body;
  }, headers);
  const deviceId = browserDevice(mine);
  expect(deviceId).toBeDefined();
  const revoked = await elsewhere.evaluate(
    async ([id, h]) => (await fetch(`/v1/devices/${id}`, { method: "DELETE", headers: h })).status,
    [encodeURIComponent(deviceId!), headers] as const,
  );
  expect(revoked).toBe(204);
  await expect(page.getByRole("alert").filter({ hasText: strings.chat_device_lost })).toBeVisible({
    timeout: 5_000,
  });
  await other.close();
});
