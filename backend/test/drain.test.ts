import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { CLIENT_HEADER } from "../src/client-version.ts";
import { device, euEnv } from "./support.ts";

// workerd resets a keep-alive connection whose request body was left unread,
// so the Worker reads a small one to its end on every answer.

const BASE = "https://spjall.test";
const CLIENT = { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}` };

function post(path: string, body: string, headers: Record<string, string>) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    body,
    headers: {
      ...CLIENT,
      "content-type": "application/json",
      "content-length": String(body.length),
      ...headers,
    },
  });
}

describe("an unread request body", () => {
  it("is read to its end when the route takes none", async () => {
    const { auth } = await device();
    const request = post("/v1/me/invite", "{}", auth);
    const response = await createApp().fetch(request, euEnv(env));
    expect(response.status).toBe(200);
    expect(request.bodyUsed).toBe(true);
  });

  it("is read to its end on a refusal before the route", async () => {
    const request = post("/v1/me/invite", "{}", {});
    const response = await createApp().fetch(request, euEnv(env));
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(true);
  });

  it("is left when it is larger than the limit", async () => {
    const request = post("/v1/me/invite", "x".repeat(64 * 1024 + 1), {});
    const response = await createApp().fetch(request, euEnv(env));
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });
});
