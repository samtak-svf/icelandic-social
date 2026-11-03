import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobHandlers, startDueTransfers } from "../../../src/modules/imports/index.ts";
import { fetchable } from "../../../src/modules/transfer/fetch.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { png } from "../../images.ts";
import { ok, person, type Person } from "../../people.ts";
import { as, call, connect, type Tokens, transferEnv } from "./flow.ts";

// What an exporter delivers (decision 0129), one item at a time. The bug each test names: a
// transferred post seen by anyone before its author opens it, an item taken twice, a photo
// lost on its way to R2 or posted outside its album, a token that expired still working,
// a full destination taking more, or a fetch reaching an address that is not public.

const QUIET_MS = 10 * 60 * 1000;
const MEDIA = "https://media.exporter.example";

afterEach(() => vi.unstubAllGlobals());

type Grants = {
  grants: { importId: string | null; posts: number; held: number; leftBehind: number }[];
};
type Page = { posts: { body: string; media: unknown[] }[] };

const deliver = (
  E: Env,
  tokens: Tokens,
  vertical: string,
  body: BodyInit,
  type = "application/json",
) =>
  call(E, `/dtp/${vertical}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": type },
    body,
  });

const activity = (id: string, content: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    "@type": "GenericPayload",
    payload: {
      activity: { id, content, published: "2019-05-17T12:00:00Z", type: "NOTE", ...over },
    },
  });

const BOUNDARY = "item-boundary";
function multipart(described: unknown, bytes: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(
    `--${BOUNDARY}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(described)}\r\n` +
      `--${BOUNDARY}\r\ncontent-type: image/png\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}
const RELATED = `multipart/related; boundary=${BOUNDARY}`;

async function summary(E: Env, who: Person) {
  const [grant] = (await ok<Grants>(await as(E, who, "GET", "/v1/transfers"))).grants;
  return grant;
}

async function drain(E: Env): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { done } = await runJobs(E, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

describe("direct transfer items", () => {
  it("brings a social post in held, owner-only, and once", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const bjorn = await person("Bjorn");
    const image = await png(4, 4);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      return new Response(image, { headers: { "content-type": "image/png" } });
    });
    const tokens = await connect(E, anna);
    const item = activity("a-1", "Fyrsta færslan", {
      attachments: [
        { type: "IMAGE", url: `${MEDIA}/1.png` },
        { type: "IMAGE", url: "https://127.0.0.1/2.png" },
        { type: "LINK", url: "https://example.org/grein" },
      ],
    });
    expect((await deliver(E, tokens, "social-posts", item)).status).toBe(200);
    expect((await deliver(E, tokens, "social-posts", item)).status).toBe(200);
    expect(fetched).toEqual([`${MEDIA}/1.png`]);

    const grant = await summary(E, anna);
    expect(grant).toMatchObject({ posts: 1, held: 1 });
    const held = await ok<Page>(await as(E, anna, "GET", `/v1/imports/${grant?.importId}/held`));
    expect(held.posts.map((p) => p.body)).toEqual(["Fyrsta færslan\n\nhttps://example.org/grein"]);
    expect(held.posts[0]?.media).toHaveLength(1);
    expect((await as(E, bjorn, "GET", `/v1/imports/${grant?.importId}/held`)).status).toBe(404);
    const wall = await ok<Page>(
      await as(E, bjorn, "GET", `/v1/accounts/${anna.accountId}/wall/posts`),
    );
    expect(wall.posts).toEqual([]);
  });

  it("stages an album's photos in R2 and gathers them under it once it is quiet", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    const album = {
      "@type": "GenericPayload",
      payload: { "@type": "Album", id: "al-1", name: "Sumar", description: "" },
    };
    expect((await deliver(E, tokens, "media", JSON.stringify(album))).status).toBe(200);
    const one = await png(3, 3);
    const two = await png(5, 5);
    for (const bytes of [one, two, one]) {
      const described = {
        "@type": "Photo",
        name: "p.png",
        albumId: "al-1",
        uploadedTime: 1_560_000_000,
      };
      expect(
        (await deliver(E, tokens, "photos", multipart(described, bytes), RELATED)).status,
      ).toBe(200);
    }
    const grant = await summary(E, anna);
    const staged = await env.MEDIA.list({ prefix: `imports/${grant?.importId}/transfer/` });
    expect(staged.objects).toHaveLength(2);

    await startDueTransfers(E, Date.now() + QUIET_MS + 1);
    await drain(E);
    const held = await ok<Page>(await as(E, anna, "GET", `/v1/imports/${grant?.importId}/held`));
    expect(held.posts).toHaveLength(1);
    expect(held.posts[0]?.body).toContain("Sumar");
    expect(held.posts[0]?.media).toHaveLength(2);
    expect(
      (await env.MEDIA.list({ prefix: `imports/${grant?.importId}/transfer/` })).objects,
    ).toEqual([]);
  });

  it("acknowledges a video and leaves it behind, counted", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    const described = { "@type": "Video", name: "v.mp4" };
    const response = await deliver(
      E,
      tokens,
      "videos",
      multipart(described, new Uint8Array(16)),
      RELATED,
    );
    expect(response.status).toBe(200);
    expect(await summary(E, anna)).toMatchObject({ leftBehind: 1 });
  });

  it("answers invalid_token to an expired token and destination_full to a full import", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    expect((await deliver(E, tokens, "social-posts", activity("b-1", "eitt"))).status).toBe(200);
    await env.DB.prepare("UPDATE transfer_imports SET items = 50000 WHERE account_id = ?")
      .bind(anna.accountId)
      .run();
    const full = await deliver(E, tokens, "social-posts", activity("b-2", "tvö"));
    expect(full.status).toBe(413);
    expect(await full.json()).toMatchObject({ error: "destination_full" });

    await env.DB.prepare(
      `UPDATE transfer_tokens SET expires_at = 1 WHERE kind = 'access'
          AND grant_id IN (SELECT grant_id FROM transfer_grants WHERE account_id = ?)`,
    )
      .bind(anna.accountId)
      .run();
    const expired = await deliver(E, tokens, "social-posts", activity("b-3", "þrjú"));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: "invalid_token" });
    expect(expired.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("answers destination_full before staging a photo that would pass the byte budget", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    const one = await png(3, 3);
    const described = { "@type": "Photo", name: "p.png", uploadedTime: 1_560_000_000 };
    const send = (bytes: Uint8Array) =>
      deliver(E, tokens, "photos", multipart(described, bytes), RELATED);
    expect((await send(one)).status).toBe(200);
    const three = await png(7, 7);
    const four = await png(9, 9);
    // Room for either of the next two but not both, so two sent at once cannot both pass.
    const room = Math.max(three.byteLength, four.byteLength);
    await env.DB.prepare("UPDATE transfer_budgets SET bytes = ? WHERE account_id = ?")
      .bind(2 * 1024 ** 3 - room, anna.accountId)
      .run();
    const answers = await Promise.all([send(three), send(four)]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 413]);
    expect(await answers.find((a) => a.status === 413)?.json()).toMatchObject({
      error: "destination_full",
    });
    const grant = await summary(E, anna);
    const staged = await env.MEDIA.list({ prefix: `imports/${grant?.importId}/transfer/` });
    expect(staged.objects).toHaveLength(2);

    // Removing the import does not give the room back.
    await env.DB.prepare("DELETE FROM import_sources WHERE import_id = ?")
      .bind(grant?.importId)
      .run();
    const kept = await env.DB.prepare("SELECT bytes FROM transfer_budgets WHERE account_id = ?")
      .bind(anna.accountId)
      .first<{ bytes: number }>();
    expect(kept?.bytes).toBeGreaterThan(2 * 1024 ** 3 - room);
  });

  it("counts a fetched post image against the byte budget", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    const image = await png(4, 4);
    vi.stubGlobal("fetch", async () => new Response(image, { status: 200 }));
    const withImage = (id: string) =>
      activity(id, "mynd", {
        attachments: [{ type: "IMAGE", url: `${MEDIA}/${id}.png` }],
      });
    expect((await deliver(E, tokens, "social-posts", withImage("i-1"))).status).toBe(200);
    const spent = await env.DB.prepare("SELECT bytes FROM transfer_budgets WHERE account_id = ?")
      .bind(anna.accountId)
      .first<{ bytes: number }>();
    expect(spent?.bytes).toBe(image.byteLength);
  });

  it("refuses a fetch to a host written with a trailing dot", () => {
    expect(fetchable(new URL("https://localhost./x.png"))).toBe(false);
    expect(fetchable(new URL("https://nas.local./x.png"))).toBe(false);
    expect(fetchable(new URL("https://media.exporter.example./x.png"))).toBe(true);
  });

  it("refuses a vertical the grant does not cover, and one that does not exist", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const tokens = await connect(E, anna);
    expect((await deliver(E, tokens, "calendar", "{}")).status).toBe(404);
    await env.DB.prepare("UPDATE transfer_grants SET scope = 'media' WHERE account_id = ?")
      .bind(anna.accountId)
      .run();
    const refused = await deliver(E, tokens, "social-posts", activity("c-1", "x"));
    expect(refused.status).toBe(403);
  });
});
