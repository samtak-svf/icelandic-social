import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { CLIENT_HEADER } from "../src/client-version.ts";
import { bareWorker, worker } from "./main.ts";
import { device } from "./support.ts";

// Decision 0037: every response names its request in x-request-id, and every
// error body names the same id in `requestId`, so a person can quote it to
// support and the log line of the failure can be found by it.

const BASE = "https://spjall.test";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT = { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}` };

/** An env whose D1 throws on first use, for a request that fails inside the Worker. */
const brokenDb = () =>
  ({
    ...env,
    DB: {
      prepare() {
        throw new Error("d1 is down");
      },
    },
  }) as unknown as Env;

describe("the request id", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is on a success response, in the header only", async () => {
    const response = await worker.fetch(`${BASE}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(await response.json()).not.toHaveProperty("requestId");
  });

  it("is the same in the header and the body of a refusal", async () => {
    const response = await worker.fetch(`${BASE}/v1/me`);
    expect(response.status).toBe(401);
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(UUID);
    expect(await response.json()).toEqual({ error: "unauthorized", requestId: id });
  });

  it("is Cloudflare's ray id when the request has one", async () => {
    const ray = "8c1f2e3d4a5b6c7d-KEF";
    const response = await worker.fetch(`${BASE}/v1/me`, { headers: { "cf-ray": ray } });
    expect(response.headers.get("x-request-id")).toBe(ray);
    expect(await response.json()).toMatchObject({ requestId: ray });
  });

  it("is made up when the ray header is not an opaque id", async () => {
    const response = await worker.fetch(`${BASE}/v1/me`, {
      headers: { "cf-ray": "not a ray <script>" },
    });
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("is on a refusal from the schema and on the client floor's", async () => {
    const { auth } = await device();
    const invalid = await worker.fetch(`${BASE}/v1/people?limit=nope`, { headers: auth });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_request",
      requestId: invalid.headers.get("x-request-id"),
    });

    const old = await bareWorker.fetch(`${BASE}/v1/me`, {
      headers: { [CLIENT_HEADER]: "android/0.0.1" },
    });
    expect(old.status).toBe(426);
    expect(await old.json()).toEqual({
      error: "client_too_old",
      minVersion: env.MIN_CLIENT_VERSION_ANDROID,
      requestId: old.headers.get("x-request-id"),
    });
  });

  it("is in the body of a 500 and on its log line, and nothing else is", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const ray = "8c1f2e3d4a5b6c7e-KEF";
    const response = await createApp().fetch(
      new Request(`${BASE}/v1/me`, {
        headers: { ...CLIENT, "cf-ray": ray, authorization: `Bearer ${"t".repeat(32)}` },
      }),
      brokenDb(),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(ray);
    expect(await response.json()).toEqual({ error: "internal_error", requestId: ray });
    const lines = logged.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toEqual([
      { event: "request.failed", code: "internal_error", status: 500, requestId: ray },
    ]);
  });

  it("is in the body of a request with a body that is not JSON", async () => {
    const { auth } = await device();
    const response = await worker.fetch(`${BASE}/v1/conversations`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("is in the body of a path no route serves", async () => {
    const response = await worker.fetch(`${BASE}/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "not_found",
      requestId: response.headers.get("x-request-id"),
    });
  });
});
