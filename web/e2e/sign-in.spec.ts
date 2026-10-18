import { expect, test, WEB } from "./origin.ts";
import { newGoogleSubject, newKennitala } from "./people.ts";

// Signing in on the web (decisions 0061, 0062): the start route, the
// provider's page, the callback on the web's host, and a session cookie that
// the API then accepts. A browser makes a session and never a device.

const providers = [
  { name: "google", person: newGoogleSubject },
  { name: "kenni", person: newKennitala },
] as const;

for (const { name, person } of providers) {
  test(`signs in with ${name} and the API knows the session`, async ({ page }) => {
    await page.goto(`${WEB}/auth/${name}/start`);
    await page.locator('input[name="login_hint"]').fill(person());
    await page.locator('input[name="x_name"]').fill("Prófa Prófsdóttir");
    await page.getByRole("button").click();
    await page.waitForURL(`${WEB}/`);

    const cookies = await page.context().cookies(WEB);
    const session = cookies.find((c) => c.name === "__Host-session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBe(true);

    const api = (path: string) =>
      page.evaluate(async (to) => {
        const answer = await fetch(to, { headers: { "spjall-client": "web/0.1.0" } });
        return { status: answer.status, body: (await answer.json()) as unknown };
      }, path);
    const me = await api("/v1/me");
    expect(me).toMatchObject({ status: 200, body: { name: "Prófa Prófsdóttir", devices: [] } });

    const sessions = await api("/v1/me/sessions");
    expect(sessions).toMatchObject({
      status: 200,
      body: { sessions: [{ kind: "web", deviceId: null }] },
    });
    expect(sessions.body).toEqual({ sessions: [expect.anything()] });
  });
}

test("without a session the API refuses", async ({ page }) => {
  await page.goto(`${WEB}/`);
  const status = await page.evaluate(
    async () => (await fetch("/v1/me", { headers: { "spjall-client": "web/0.1.0" } })).status,
  );
  expect(status).toBe(401);
});
