import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { png } from "./images.ts";
import { worker } from "./main.ts";
import { device } from "./support.ts";

// Per-screen framing (decision 0086), through the routes and the real Images
// binding. What the real binding does honestly is tested here: the master,
// the sizes, the routes, permissions, delete and the legacy fallback. Where
// each frame is cut from is tested in image-frames-cut.test.ts, because local
// workerd ignores `trim`.

const BASE = "https://spjall.test";
type Person = Awaited<ReturnType<typeof person>>;
type Kind = "avatar" | "cover";

async function person(name: string) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = 1 WHERE account_id = ?")
    .bind(name, seeded.accountId)
    .run();
  const call = (method: string, path: string, body?: BodyInit, headers: HeadersInit = {}) =>
    worker.fetch(`${BASE}${path}`, { method, headers: { ...seeded.auth, ...headers }, body });
  return { ...seeded, call };
}

const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
const JSON_HEADERS = { "content-type": "application/json" };
const BINARY = { "content-type": "application/octet-stream" };

async function create(owner: Person) {
  const response = await owner.call(
    "POST",
    "/v1/communities",
    JSON.stringify({ name: "Prjónaklúbbur", audience: "open" }),
    JSON_HEADERS,
  );
  return ((await response.json()) as { communityId: string }).communityId;
}

async function moderator(owner: Person, id: string) {
  const mod = await person("Umsjón");
  expect((await mod.call("POST", `/v1/communities/${id}/join`)).status).toBe(200);
  const role = await owner.call(
    "PUT",
    `/v1/communities/${id}/members/${mod.accountId}/role`,
    JSON.stringify({ role: "moderator" }),
    JSON_HEADERS,
  );
  expect(role.status).toBe(204);
  return mod;
}

const put = (by: Person, id: string, kind: Kind, body: Uint8Array) =>
  by.call("PUT", `/v1/communities/${id}/${kind}`, body, BINARY);
const patch = (by: Person, id: string, kind: Kind, body: unknown) =>
  by.call("PATCH", `/v1/communities/${id}/${kind}/frames`, JSON.stringify(body), JSON_HEADERS);
const get = (by: Person, id: string, kind: Kind, query = "") =>
  by.call("GET", `/v1/communities/${id}/${kind}${query}`);
const source = (by: Person, id: string, kind: Kind) =>
  by.call("GET", `/v1/communities/${id}/${kind}/source`);

type Framed = {
  photo: string | null;
  cover: string | null;
  photoFrames: unknown;
  coverFrames: unknown;
};
async function community(by: Person, id: string) {
  return (await (await by.call("GET", `/v1/communities/${id}`)).json()) as Framed;
}

async function infoOf(response: Response) {
  expect(response.status).toBe(200);
  return env.IMAGES.info(new Blob([await response.arrayBuffer()]).stream());
}

/** The size of the object at `key` in the profiles bucket. */
async function sizeAt(key: string) {
  const object = await env.PROFILES.get(key);
  expect(object, key).not.toBeNull();
  return env.IMAGES.info(object!.body);
}

const COVER_KEYS = (id: string) => [
  `community/${id}/cover`,
  `community/${id}/cover/master`,
  `community/${id}/cover/compact`,
  `community/${id}/cover/medium`,
];

describe("a community cover is stored as a master and one frame per size class", () => {
  it("keeps every frame at the exact size, and a master capped at 2400 px", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    expect((await put(owner, id, "cover", await png(3000, 1000))).status).toBe(200);

    expect(await sizeAt(`community/${id}/cover`)).toMatchObject({ width: 1600, height: 600 });
    expect(await sizeAt(`community/${id}/cover/compact`)).toMatchObject({
      width: 1200,
      height: 400,
    });
    expect(await sizeAt(`community/${id}/cover/medium`)).toMatchObject({
      width: 1600,
      height: 400,
    });
    expect(await sizeAt(`community/${id}/cover/master`)).toMatchObject({
      format: "image/webp",
      width: 2400,
      height: 800,
    });
    // A picture has its square and its master, nothing else.
    expect((await put(owner, id, "avatar", await png(900, 300))).status).toBe(200);
    expect(await sizeAt(`community/${id}/photo`)).toMatchObject({ width: 512, height: 512 });
    const keys = (await env.PROFILES.list({ prefix: `community/${id}/photo` })).objects.map(
      (o) => o.key,
    );
    expect(keys.sort()).toEqual([`community/${id}/photo`, `community/${id}/photo/master`]);
  });

  it("never upscales a small upload into the master", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(300, 200));
    expect(await sizeAt(`community/${id}/cover/master`)).toMatchObject({ width: 300, height: 200 });
  });

  it("serves a frame by ?frame, and the legacy one without it", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(900, 300));
    expect(await infoOf(await get(owner, id, "cover"))).toMatchObject({ width: 1600, height: 600 });
    expect(await infoOf(await get(owner, id, "cover", "?frame=expanded"))).toMatchObject({
      width: 1600,
      height: 600,
    });
    expect(await infoOf(await get(owner, id, "cover", "?frame=compact"))).toMatchObject({
      width: 1200,
      height: 400,
    });
    expect(await infoOf(await get(owner, id, "cover", "?frame=medium"))).toMatchObject({
      width: 1600,
      height: 400,
    });
    expect((await get(owner, id, "cover", "?frame=square")).status).toBe(400);
  });

  it("starts centred, and a PATCH frames it again with a new version", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(900, 300));
    expect(await community(owner, id)).toMatchObject({
      coverFrames: { focus: { x: 0.5, y: 0.5 } },
      photoFrames: null,
    });
    const before = (await community(owner, id)).cover;

    const framing = {
      focus: { x: 0.2, y: 0.8 },
      overrides: { compact: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
    };
    const patched = await patch(owner, id, "cover", framing);
    expect(patched.status).toBe(200);
    const { version } = (await patched.json()) as { version: string };
    expect(version).toMatch(/^ph_/);
    expect(version).not.toBe(before);
    expect(await community(owner, id)).toMatchObject({ cover: version, coverFrames: framing });
    // The frames keep their sizes.
    expect(await infoOf(await get(owner, id, "cover", "?frame=compact"))).toMatchObject({
      width: 1200,
      height: 400,
    });

    // A new upload is centred again.
    await put(owner, id, "cover", await png(900, 300));
    expect(await community(owner, id)).toMatchObject({
      coverFrames: { focus: { x: 0.5, y: 0.5 } },
    });
  });

  it("refuses a framing that does not fit, and a PATCH without an image", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    expect((await patch(owner, id, "cover", { focus: { x: 0.5, y: 0.5 } })).status).toBe(404);
    await put(owner, id, "avatar", await png(900, 300));
    const wrongFrame = await patch(owner, id, "avatar", {
      focus: { x: 0.5, y: 0.5 },
      overrides: { compact: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    });
    expect(wrongFrame.status).toBe(400);
    expect((await patch(owner, id, "avatar", { focus: { x: 2, y: 0 } })).status).toBe(400);
    expect(
      (
        await patch(owner, id, "avatar", {
          focus: { x: 0, y: 0 },
          overrides: { square: { x: 0.8, y: 0, w: 0.5, h: 0.5 } },
        })
      ).status,
    ).toBe(400);
  });

  it("answers 409 no_master for an image stored before masters, which still serves every frame", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    // What an upload left before decision 0086: one object at the key and a version.
    const legacy = await (
      await env.IMAGES.input(new Blob([await png(1600, 600)]).stream()).output({
        format: "image/webp",
      })
    )
      .response()
      .arrayBuffer();
    await env.PROFILES.put(`community/${id}/cover`, legacy);
    await env.DB.prepare(
      "UPDATE communities SET cover_version = 'ph_legacy' WHERE community_id = ?",
    )
      .bind(id)
      .run();

    for (const frame of ["", "?frame=compact", "?frame=medium", "?frame=expanded"]) {
      expect(await infoOf(await get(owner, id, "cover", frame))).toMatchObject({ width: 1600 });
    }
    expect(await community(owner, id)).toMatchObject({ cover: "ph_legacy", coverFrames: null });
    const refused = await patch(owner, id, "cover", { focus: { x: 0, y: 0 } });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("no_master");
    expect((await source(owner, id, "cover")).status).toBe(404);
  });

  it("gives the master to who may change the image, and to nobody else", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(900, 300));
    const mod = await moderator(owner, id);
    const member = await person("Félagi");
    await member.call("POST", `/v1/communities/${id}/join`);
    const outsider = await person("Gestur");

    expect(await infoOf(await source(owner, id, "cover"))).toMatchObject({
      width: 900,
      height: 300,
    });
    expect((await source(mod, id, "cover")).status).toBe(200);
    for (const other of [member, outsider]) {
      const refused = await source(other, id, "cover");
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
    }
    // No image, no master.
    expect((await source(owner, id, "avatar")).status).toBe(404);
  });

  it("lets a moderator but no member re-frame, and logs it as a change of the cover", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(900, 300));
    const mod = await moderator(owner, id);
    const member = await person("Félagi");
    await member.call("POST", `/v1/communities/${id}/join`);

    const body = { focus: { x: 0.9, y: 0.1 } };
    expect((await patch(mod, id, "cover", body)).status).toBe(200);
    const refused = await patch(member, id, "cover", body);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    expect((await patch(await person("Gestur"), id, "cover", body)).status).toBe(403);
    const log = (await (
      await owner.call("GET", `/v1/communities/${id}/moderation-log`)
    ).json()) as {
      entries: { action: string }[];
    };
    expect(log.entries.filter((e) => e.action === "set_community_cover")).toHaveLength(2);
  });

  it("removes the master and every frame with the image", async () => {
    const owner = await person("Eigandi");
    const id = await create(owner);
    await put(owner, id, "cover", await png(900, 300));
    for (const key of COVER_KEYS(id)) expect(await env.PROFILES.head(key), key).not.toBeNull();
    expect((await owner.call("DELETE", `/v1/communities/${id}/cover`)).status).toBe(204);
    for (const key of COVER_KEYS(id)) expect(await env.PROFILES.head(key), key).toBeNull();
    expect(await community(owner, id)).toMatchObject({ cover: null, coverFrames: null });
  });
});

describe("a profile photo is framed the same way", () => {
  const set = (by: Person, body: Uint8Array) => by.call("PUT", "/v1/me/photo", body, BINARY);

  it("keeps a master beside the square, re-frames it and reports the framing", async () => {
    const me = await person("Mynd");
    const { photo } = (await (await set(me, await png(900, 300))).json()) as { photo: string };
    expect(await sizeAt(`${me.accountId}/master`)).toMatchObject({ width: 900, height: 300 });
    expect(await sizeAt(me.accountId)).toMatchObject({ width: 512, height: 512 });

    const profile = async () =>
      (await (await me.call("GET", `/v1/accounts/${me.accountId}`)).json()) as {
        photo: string;
        photoFrames: unknown;
      };
    expect(await profile()).toMatchObject({ photo, photoFrames: { focus: { x: 0.5, y: 0.5 } } });

    const patched = await me.call(
      "PATCH",
      "/v1/me/photo/frames",
      JSON.stringify({ focus: { x: 0.1, y: 0.5 } }),
      JSON_HEADERS,
    );
    expect(patched.status).toBe(200);
    const next = ((await patched.json()) as { photo: string }).photo;
    expect(next).not.toBe(photo);
    expect(await profile()).toMatchObject({
      photo: next,
      photoFrames: { focus: { x: 0.1, y: 0.5 } },
    });
    expect(
      await infoOf(await me.call("GET", `/v1/accounts/${me.accountId}/photo?frame=square`)),
    ).toMatchObject({
      width: 512,
      height: 512,
    });
    expect(await infoOf(await me.call("GET", "/v1/me/photo/source"))).toMatchObject({ width: 900 });
  });

  it("gives the master to the account alone, and refuses a framing without a photo", async () => {
    const [me, other] = [await person("Mynd"), await person("Annar")];
    await set(me, await png(40, 30));
    // /v1/me/photo/source is always the caller's own: an account without a photo gets 404.
    expect((await other.call("GET", "/v1/me/photo/source")).status).toBe(404);
    const none = await other.call(
      "PATCH",
      "/v1/me/photo/frames",
      JSON.stringify({ focus: { x: 0, y: 0 } }),
      JSON_HEADERS,
    );
    expect(none.status).toBe(404);
    const wrong = await me.call(
      "PATCH",
      "/v1/me/photo/frames",
      JSON.stringify({
        focus: { x: 0, y: 0 },
        overrides: { medium: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      }),
      JSON_HEADERS,
    );
    expect(wrong.status).toBe(400);
  });

  it("answers 409 no_master for a photo stored before masters", async () => {
    const me = await person("Gamall");
    const legacy = await (
      await env.IMAGES.input(new Blob([await png(512, 512)]).stream()).output({
        format: "image/webp",
      })
    )
      .response()
      .arrayBuffer();
    await env.PROFILES.put(me.accountId, legacy);
    await env.DB.prepare("UPDATE accounts SET photo_version = 'ph_legacy' WHERE account_id = ?")
      .bind(me.accountId)
      .run();
    expect(
      await infoOf(await me.call("GET", `/v1/accounts/${me.accountId}/photo?frame=square`)),
    ).toMatchObject({ width: 512 });
    const refused = await me.call(
      "PATCH",
      "/v1/me/photo/frames",
      JSON.stringify({ focus: { x: 0, y: 0 } }),
      JSON_HEADERS,
    );
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("no_master");
  });

  it("removes the master with the photo", async () => {
    const me = await person("Mynd");
    await set(me, await png(40, 30));
    expect(await env.PROFILES.head(`${me.accountId}/master`)).not.toBeNull();
    await me.call("DELETE", "/v1/me/photo");
    expect(await env.PROFILES.head(`${me.accountId}/master`)).toBeNull();
    expect(await env.PROFILES.head(me.accountId)).toBeNull();
  });
});
