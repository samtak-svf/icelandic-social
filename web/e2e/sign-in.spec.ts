import { strings } from "../src/generated/brand/strings.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";
import { newGoogleSubject } from "./people.ts";

// Signing in on the web (decisions 0061, 0062, 0069): the start route,
// Google's page, the callback on the web's host, and a session cookie that the
// API then accepts. A browser makes a session and never a device. Kenni is no
// way in: its start needs a session.

test("signs in with Google and the API knows the session", async ({ page }) => {
  await page.goto(`${WEB}/auth/google/start`);
  await page.locator('input[name="login_hint"]').fill(newGoogleSubject());
  await page.locator('input[name="x_name"]').fill("Prófa Prófsdóttir");
  await page.getByRole("button").click();
  await page.waitForURL(`${WEB}/`);

  const cookies = await page.context().cookies(WEB);
  const session = cookies.find((c) => c.name === "__Host-session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);

  const api = (path: string) =>
    page.evaluate(
      async ([to, headers]) => {
        const answer = await fetch(to, { headers });
        return { status: answer.status, body: (await answer.json()) as unknown };
      },
      [path, CLIENT] as const,
    );
  const me = await api("/v1/me");
  expect(me).toMatchObject({ status: 200, body: { name: "Prófa Prófsdóttir", devices: [] } });

  const sessions = await api("/v1/me/sessions");
  expect(sessions).toMatchObject({
    status: 200,
    body: { sessions: [{ kind: "web", deviceId: null }] },
  });
  expect(sessions.body).toEqual({ sessions: [expect.anything()] });
});

test("a link opened signed out comes back to its page after signing in", async ({ page }) => {
  await page.goto(`${WEB}/communities?from=link`);
  await page.getByRole("link", { name: strings.sign_in_google }).click();
  await page.locator('input[name="login_hint"]').fill(newGoogleSubject());
  await page.locator('input[name="x_name"]').fill("Prófa Prófsdóttir");
  await page.getByRole("button").click();
  await page.waitForURL(`${WEB}/communities?from=link`);
  await expect(page.getByRole("link", { name: strings.tab_communities })).toBeVisible();
});

test("starts no Kenni flow without a session", async ({ page }) => {
  const answer = await page.goto(`${WEB}/auth/kenni/start`);
  expect(answer?.status()).toBe(401);
  const cookies = await page.context().cookies(WEB);
  expect(cookies.map((c) => c.name)).not.toContain("__Host-sign-in");
});

test("without a session the API refuses", async ({ page }) => {
  await page.goto(`${WEB}/`);
  const status = await page.evaluate(
    async (headers) => (await fetch("/v1/me", { headers })).status,
    CLIENT,
  );
  expect(status).toBe(401);
});
