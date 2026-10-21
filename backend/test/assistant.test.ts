import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteOrphans } from "../src/account-deletion.ts";
import { createApp } from "../src/app.ts";
import { brandStrings } from "../src/brand.gen.ts";
import { CLIENT_HEADER } from "../src/client-version.ts";
import { jobHandlers } from "../src/modules/assistant/index.ts";
import { maskAddresses, parseAddress, platformOf } from "../src/modules/assistant/address.ts";
import type { Model } from "../src/modules/assistant/model.ts";
import { runJobs } from "../src/modules/jobs/index.ts";
import { community, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// The testers' assistant (decision 0076): a comment in its community queues
// the address it gives, the model answers within the month's cap, the
// maintainer's machine takes the queue through /ops, and the assistant's
// account outlives the sweep of accounts without a sign-in.

const BASE = "https://spjall.test";
const TOKEN = (env as Env & { OPS_TOKEN: string }).OPS_TOKEN;

type Comment = { commentId: string; body: string; author: { accountId: string } };
type Pending = { requestId: string; platform: string; address: string };

/** The Worker with the assistant pointed at `communityId`. */
function assistantEnv(communityId: string, extra: Partial<Record<string, string>> = {}): Env {
  return {
    ...euEnv(env),
    ASSISTANT_COMMUNITY_ID: communityId,
    ASSISTANT_ANDROID_GROUP_URL: "",
    ANTHROPIC_API_KEY: "test-only-anthropic-key",
    ...extra,
  } as Env;
}

const call = (
  on: Env,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
) =>
  createApp().fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: {
        [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}`,
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    on,
  );

const as = (one: Person, on: Env, method: string, path: string, body?: unknown) =>
  call(on, method, path, body, one.auth as Record<string, string>);

/** A model that answers `text` and records what it was given. */
function fakeModel(text = "Takk, þú ert á listanum.") {
  const seen: string[] = [];
  const model: Model = async (_key, _system, thread) => {
    seen.push(thread);
    return { text, inputTokens: 1000, outputTokens: 100, complete: true };
  };
  return { model, seen };
}

/** The assistant's community with a post, and the assistant set up in it. */
async function scene() {
  const [owner, tester] = [await person("Eigandi"), await person("Prófari")];
  const communityId = await community(owner, "open", tester);
  const on = assistantEnv(communityId);
  const { accountId: assistant } = await ok<{ accountId: string }>(
    await call(on, "POST", "/ops/assistant/account"),
  );
  const { postId } = await ok<{ postId: string }>(
    await as(owner, on, "POST", `/v1/communities/${communityId}/posts`, {
      body: "Viltu prófa?",
      media: [],
    }),
  );
  return { owner, tester, communityId, on, assistant, postId };
}

const comments = async (one: Person, on: Env, postId: string) =>
  (await ok<{ comments: Comment[] }>(await as(one, on, "GET", `/v1/posts/${postId}/comments`)))
    .comments;

const run = (on: Env, model: Model) => runJobs(on, jobHandlers(model), Date.now() + 1);

const pending = async (on: Env, platform = "ios") =>
  (
    await ok<{ requests: Pending[] }>(
      await call(on, "GET", `/ops/testers/pending?platform=${platform}`),
    )
  ).requests;

describe("reading a tester's comment", () => {
  it("finds one address, and none in two different ones", () => {
    expect(parseAddress("Apple ID: Prufa.Notandi@iCloud.com takk")).toBe(
      "prufa.notandi@icloud.com",
    );
    expect(parseAddress("a@b.is og a@b.is")).toBe("a@b.is");
    expect(parseAddress("a@b.is eða c@d.is")).toBeNull();
    expect(parseAddress("ekkert netfang")).toBeNull();
  });

  it("takes an iPhone unless only Android is named", () => {
    expect(platformOf(["Ég er með Samsung Galaxy"])).toBe("android");
    expect(platformOf(["Samsung", "og iPhone líka"])).toBe("ios");
    expect(platformOf(["hér er netfangið"])).toBe("ios");
  });

  it("masks every address before the model reads it", () => {
    expect(maskAddresses("x@y.is og z@w.com", "[netfang]")).toBe("[netfang] og [netfang]");
  });
});

describe("the assistant", () => {
  it("queues the address, answers once, and the queue tells the tester when it is done", async () => {
    const { tester, on, assistant, postId } = await scene();
    const address = `prufa.${crypto.randomUUID().slice(0, 8)}@example.com`;
    await as(tester, on, "POST", `/v1/posts/${postId}/comments`, { body: `iPhone: ${address}` });
    const { model, seen } = fakeModel();
    await run(on, model);

    const [request] = await pending(on);
    expect(request).toMatchObject({ platform: "ios", address });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(address);
    expect(seen[0]).toContain("has been queued");
    let thread = await comments(tester, on, postId);
    expect(thread.filter((c) => c.author.accountId === assistant)).toHaveLength(1);

    // A second run of the same job answers nothing more.
    await env.DB.prepare(
      "UPDATE jobs SET state = 'pending', run_after = 0 WHERE kind = 'assistant'",
    ).run();
    await run(on, model);
    expect(seen).toHaveLength(1);

    const marked = await call(on, "POST", `/ops/testers/${request!.requestId}`, {
      outcome: "done",
    });
    expect(marked.status).toBe(200);
    expect(await pending(on)).toEqual([]);
    thread = await comments(tester, on, postId);
    expect(thread.at(-1)).toMatchObject({
      body: brandStrings.assistant_added_ios,
      author: { accountId: assistant },
    });
    const row = await env.DB.prepare(
      "SELECT address, state FROM tester_requests WHERE request_id = ?",
    )
      .bind(request!.requestId)
      .first();
    expect(row).toEqual({ address: null, state: "done" });
    expect(
      (await call(on, "POST", `/ops/testers/${request!.requestId}`, { outcome: "done" })).status,
    ).toBe(404);
  });

  it("answers no comment of its own, and none outside its community", async () => {
    const { owner, tester, on, postId } = await scene();
    const elsewhere = await community(owner, "open", tester);
    const { postId: other } = await ok<{ postId: string }>(
      await as(owner, on, "POST", `/v1/communities/${elsewhere}/posts`, {
        body: "Annað",
        media: [],
      }),
    );
    await as(tester, on, "POST", `/v1/posts/${other}/comments`, { body: "a@example.com" });
    const { model, seen } = fakeModel();
    await run(on, model);
    expect(seen).toEqual([]);

    // The assistant's own reply, posted by the maintainer, wakes no job.
    expect(
      (
        await call(
          on,
          "POST",
          "/ops/mcp",
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "reply_as_assistant", arguments: { postId, body: "Halló" } },
          },
          { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" },
        )
      ).status,
    ).toBe(200);
    await run(on, model);
    expect(seen).toEqual([]);
  });

  it("stays silent when the model says nothing is needed", async () => {
    const { tester, on, assistant, postId } = await scene();
    await as(tester, on, "POST", `/v1/posts/${postId}/comments`, { body: "Takk fyrir" });
    await run(on, fakeModel(brandStrings.assistant_silence).model);
    const thread = await comments(tester, on, postId);
    expect(thread.some((c) => c.author.accountId === assistant)).toBe(false);
  });

  it("calls no model once the month has reached its cap", async () => {
    const { tester, on, postId } = await scene();
    const month = new Date().toISOString().slice(0, 7);
    await env.DB.prepare(
      `INSERT INTO assistant_usage (month, cost_micro_usd) VALUES (?, 10000000)
       ON CONFLICT (month) DO UPDATE SET cost_micro_usd = 10000000, refused = 0`,
    )
      .bind(month)
      .run();
    await as(tester, on, "POST", `/v1/posts/${postId}/comments`, { body: "Hvernig?" });
    const { model, seen } = fakeModel();
    await run(on, model);
    expect(seen).toEqual([]);
    const usage = await ok<{ refused: number }>(await call(on, "GET", "/ops/assistant/usage"));
    expect(usage.refused).toBe(1);
    await env.DB.prepare("DELETE FROM assistant_usage").run();
  });

  it("is never swept as an account without a sign-in", async () => {
    const { on, assistant } = await scene();
    await deleteOrphans(on);
    const row = await env.DB.prepare("SELECT kind FROM accounts WHERE account_id = ?")
      .bind(assistant)
      .first();
    expect(row).toEqual({ kind: "assistant" });
  });
});

describe("the assistant's /ops routes", () => {
  it("are not found without the token", async () => {
    const on = assistantEnv("cm_none");
    for (const [method, path] of [
      ["POST", "/ops/assistant/account"],
      ["GET", "/ops/assistant/usage"],
      ["GET", "/ops/testers/pending"],
      ["POST", "/ops/testers/tr_x"],
      ["POST", "/ops/mcp"],
    ] as const) {
      const body = method === "GET" ? undefined : {};
      expect((await call(on, method, path, body, {})).status, `${method} ${path}`).toBe(404);
    }
  });

  it("list the MCP tools", async () => {
    const response = await call(
      assistantEnv("cm_none"),
      "POST",
      "/ops/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" },
    );
    expect(response.status).toBe(200);
    const { result } = await response.json<{ result: { tools: { name: string }[] } }>();
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      "assistant_usage",
      "list_tester_requests",
      "mark_tester_request",
      "reply_as_assistant",
    ]);
  });
});
