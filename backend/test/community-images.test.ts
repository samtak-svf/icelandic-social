import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { ascii, png } from "./images.ts";
import { device } from "./support.ts";
import { worker } from "./main.ts";

// A community's picture and cover (decision 0080): the account photo's path
// with another size and key, written by the owner and the moderators, read by
// whoever the community's read rule admits.

const BASE = "https://spjall.test";

type Person = Awaited<ReturnType<typeof person>>;
type Kind = "avatar" | "cover";
type Entry = { action: string; actor: { accountId: string } | null; target: { id: string } };

async function person(name: string) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = 1 WHERE account_id = ?")
    .bind(name, seeded.accountId)
    .run();
  const call = (method: string, path: string, body?: BodyInit, headers: HeadersInit = {}) =>
    worker.fetch(`${BASE}${path}`, {
      method,
      headers: { ...seeded.auth, ...headers },
      body,
    });
  return { ...seeded, call };
}

const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

async function create(owner: Person, audience: "open" | "private") {
  const response = await owner.call(
    "POST",
    "/v1/communities",
    JSON.stringify({ name: "Prjónaklúbbur", audience }),
    { "content-type": "application/json" },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { communityId: string }).communityId;
}

const put = (by: Person, id: string, kind: Kind, body: Uint8Array) =>
  by.call("PUT", `/v1/communities/${id}/${kind}`, body, {
    "content-type": "application/octet-stream",
  });
const remove = (by: Person, id: string, kind: Kind) =>
  by.call("DELETE", `/v1/communities/${id}/${kind}`);
const read = (by: Person, id: string, kind: Kind) =>
  by.call("GET", `/v1/communities/${id}/${kind}`);

async function community(by: Person, id: string) {
  const response = await by.call("GET", `/v1/communities/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { photo: string | null; cover: string | null };
}

async function join(by: Person, id: string) {
  expect((await by.call("POST", `/v1/communities/${id}/join`)).status).toBe(200);
}

/** Makes `target` a member of the open community `id`, with `role`. */
async function enroll(owner: Person, target: Person, id: string, role: "member" | "moderator") {
  await join(target, id);
  if (role === "moderator") {
    const response = await owner.call(
      "PUT",
      `/v1/communities/${id}/members/${target.accountId}/role`,
      JSON.stringify({ role }),
      { "content-type": "application/json" },
    );
    expect(response.status).toBe(204);
  }
}

const logOf = async (by: Person, id: string) =>
  (
    (await (await by.call("GET", `/v1/communities/${id}/moderation-log`)).json()) as {
      entries: Entry[];
    }
  ).entries;

const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"></svg>');

describe("a community's picture and cover (decision 0080)", () => {
  it("is set by the owner, shows in the community and is removed again", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner, "open");
    expect(await community(owner, id)).toMatchObject({ photo: null, cover: null });

    const set = await put(owner, id, "avatar", await png(40, 30));
    expect(set.status).toBe(200);
    const { version } = (await set.json()) as { version: string };
    expect(version).toMatch(/^ph_/);
    expect(await community(owner, id)).toEqual(
      expect.objectContaining({ photo: version, cover: null }),
    );

    // A replacement is a new version, so a client fetches it again.
    const again = (await (await put(owner, id, "avatar", await png(41, 31))).json()) as {
      version: string;
    };
    expect(again.version).not.toBe(version);

    expect((await remove(owner, id, "avatar")).status).toBe(204);
    expect(await community(owner, id)).toMatchObject({ photo: null });
    expect((await read(owner, id, "avatar")).status).toBe(404);
    expect(await env.PROFILES.head(`community/${id}/photo`)).toBeNull();
    // Removing what is not there is no error.
    expect((await remove(owner, id, "avatar")).status).toBe(204);
  });

  it("stores the picture at 512 by 512 and the cover at 1600 by 600, as WebP", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner, "open");
    expect((await put(owner, id, "avatar", await png(900, 300))).status).toBe(200);
    expect((await put(owner, id, "cover", await png(300, 200))).status).toBe(200);
    expect(await community(owner, id)).toMatchObject({
      photo: expect.any(String),
      cover: expect.any(String),
    });
    for (const [kind, width, height] of [
      ["avatar", 512, 512],
      ["cover", 1600, 600],
    ] as const) {
      const fetched = await read(owner, id, kind);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get("content-type")).toBe("image/webp");
      expect(fetched.headers.get("cache-control")).toBe("private, max-age=3600");
      const stored = await fetched.arrayBuffer();
      const info = await env.IMAGES.info(new Blob([stored]).stream());
      expect(info).toMatchObject({ format: "image/webp", width, height });
    }
  });

  it("is set by a moderator and refused to a plain member and an outsider", async () => {
    const [owner, moderator, member, outsider] = [
      await person("Eigandi"),
      await person("Stjórnandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const id = await create(owner, "open");
    await enroll(owner, moderator, id, "moderator");
    await enroll(owner, member, id, "member");
    expect((await put(moderator, id, "cover", await png(40, 30))).status).toBe(200);
    for (const refused of [member, outsider]) {
      const response = await put(refused, id, "avatar", await png(40, 30));
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("not_permitted");
      expect((await remove(refused, id, "cover")).status).toBe(403);
    }
    expect(await community(owner, id)).toMatchObject({ photo: null, cover: expect.any(String) });
    expect((await put(owner, "cm_0000000000000000", "avatar", await png(4, 4))).status).toBe(404);
  });

  it("refuses an SVG and what is not an image, and keeps the picture it had", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner, "open");
    const { version } = (await (await put(owner, id, "avatar", await png(40, 30))).json()) as {
      version: string;
    };
    for (const body of [SVG, ascii("not an image at all")]) {
      const response = await put(owner, id, "avatar", body);
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_image");
    }
    expect(await community(owner, id)).toMatchObject({ photo: version });
    expect((await read(owner, id, "avatar")).status).toBe(200);
  });

  it("is as private as the community: a private one's is read by its members only", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const id = await create(owner, "private");
    expect((await put(owner, id, "avatar", await png(40, 30))).status).toBe(200);
    expect((await put(owner, id, "cover", await png(40, 30))).status).toBe(200);
    expect(
      (await owner.call("PUT", `/v1/communities/${id}/invitations/${member.accountId}`)).status,
    ).toBe(204);
    await join(member, id);

    for (const kind of ["avatar", "cover"] as const) {
      expect((await read(owner, id, kind)).status).toBe(200);
      expect((await read(member, id, kind)).status).toBe(200);
      const refused = await read(outsider, id, kind);
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
      // Signed out: no credentials at all.
      expect((await worker.fetch(`${BASE}/v1/communities/${id}/${kind}`)).status).toBe(401);
    }
  });

  it("is read by any signed-in account when the community is open", async () => {
    const [owner, reader] = [await person("Eigandi"), await person("Lesandi")];
    const id = await create(owner, "open");
    await put(owner, id, "avatar", await png(40, 30));
    expect((await read(reader, id, "avatar")).status).toBe(200);
    expect((await worker.fetch(`${BASE}/v1/communities/${id}/avatar`)).status).toBe(401);
  });

  it("writes a moderation log entry for every set and remove", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner, "open");
    await put(owner, id, "avatar", await png(40, 30));
    await put(owner, id, "cover", await png(40, 30));
    await remove(owner, id, "avatar");
    await remove(owner, id, "cover");
    // Nothing was there to remove, so nothing is logged.
    await remove(owner, id, "cover");
    const entries = await logOf(owner, id);
    expect(entries.map((e) => e.action).sort()).toEqual([
      "remove_community_cover",
      "remove_community_picture",
      "set_community_cover",
      "set_community_picture",
    ]);
    for (const e of entries) {
      expect(e.actor?.accountId).toBe(owner.accountId);
      expect(e.target.id).toBe(id);
    }
  });

  it("is deleted from R2 with the community's media", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner, "open");
    await put(owner, id, "avatar", await png(40, 30));
    await put(owner, id, "cover", await png(40, 30));
    expect(await env.PROFILES.head(`community/${id}/photo`)).not.toBeNull();
    expect(await env.PROFILES.head(`community/${id}/cover`)).not.toBeNull();
    const { deleteCommunityMedia } = await import("../src/modules/social/media.ts");
    await deleteCommunityMedia(env, id);
    expect(await env.PROFILES.head(`community/${id}/photo`)).toBeNull();
    expect(await env.PROFILES.head(`community/${id}/cover`)).toBeNull();
  });
});
