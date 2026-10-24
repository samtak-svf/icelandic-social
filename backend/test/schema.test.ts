import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The schema after every migration. Migrations are append-only, so a table a
// decision retires is dropped by a later one (0026, decision 0084).

describe("the schema after the migrations", () => {
  it("has no table or index of the retired tester assistant", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE name IN ('tester_requests', 'tester_requests_pending', 'assistant_usage', 'assistant_answers')`,
    ).all<{ name: string }>();
    expect(results).toEqual([]);
  });
});
