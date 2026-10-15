import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { CLIENT_HEADER } from "../src/client-version.ts";
import { device } from "./support.ts";

// Decision 0056: the device-token lookup is the D1 round trip every
// authenticated request pays first, so its time is logged, and nothing else.

const BASE = "https://spjall.test";
const CLIENT = { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}` };

describe("the token lookup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs its duration and the request id for a request with a token", async () => {
    const { auth } = await device();
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const ray = "8c1f2e3d4a5b6c7f-KEF";
    const response = await createApp().fetch(
      new Request(`${BASE}/v1/blocks`, { headers: { ...CLIENT, ...auth, "cf-ray": ray } }),
      env,
    );
    expect(response.status).toBe(200);
    const lines = logged.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toEqual([
      { event: "auth.token_checked", durationMs: expect.any(Number), requestId: ray },
    ]);
  });

  it("logs nothing for a request without a token", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await createApp().fetch(
      new Request(`${BASE}/v1/blocks`, { headers: CLIENT }),
      env,
    );
    expect(response.status).toBe(401);
    expect(logged).not.toHaveBeenCalled();
  });
});
