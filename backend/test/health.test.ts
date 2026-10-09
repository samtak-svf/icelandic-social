import { describe, expect, it } from "vitest";
import { Health } from "../src/api/health.ts";
import { worker } from "./main.ts";

describe("/health", () => {
  it("reports ok and the minimum client version per platform", async () => {
    const response = await worker.fetch("https://spjall.test/health");
    expect(response.status).toBe(200);
    const body = Health.parse(await response.json());
    expect(body.minClientVersion).toEqual({ android: "0.1.0", ios: "0.1.0" });
  });

  it("is the only route so far", async () => {
    const response = await worker.fetch("https://spjall.test/nope");
    expect(response.status).toBe(404);
  });
});
