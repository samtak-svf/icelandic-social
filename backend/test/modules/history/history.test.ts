import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { ApiError } from "../../../src/api/common.ts";
import { createApp, DOCUMENT_INFO } from "../../../src/app.ts";
import { toBase64 } from "../../../src/shared/bytes.ts";
import { deleteAccountHistory, expireHistory } from "../../../src/modules/history/index.ts";
import { PART_SIZE } from "../../../src/shared/multipart.ts";
import { MAX_HISTORY_CIPHERTEXT, TRANSFER_MS } from "../../../src/modules/history/transfers.ts";
import { worker } from "../../main.ts";
import { device, euEnv, phoneWithKey, revoke, webSession } from "../../support.ts";

// History from a sibling device (decision 0064, #300): the phone that
// approved a link uploads opaque ciphertext in parts, the device the link
// made downloads it and deletes it, and nothing is kept past 24 hours or past
// the account.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);

/** `n` random bytes; getRandomValues fills at most 64 KiB a call. */
function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 65536) {
    crypto.getRandomValues(out.subarray(at, Math.min(n, at + 65536)));
  }
  return out;
}

/** A history blob as the core frames it: magic, version, an encapsulation, then sealed bytes. */
function sealedHistory(size: number): Uint8Array {
  const blob = bytes(size);
  blob.set(new TextEncoder().encode("SPJH"), 0);
  blob[4] = 1;
  return blob;
}

/**
 * A link its account's phone approved, and the browser session that started
 * it; `complete` also makes the linked device, with its bearer headers.
 */
async function approvedLink({ complete = true } = {}) {
  const phone = await phoneWithKey();
  const browser = await webSession({ accountId: phone.accountId });
  const deviceKey = crypto.getRandomValues(new Uint8Array(32));
  const started = await fetch("/v1/devices/link-requests", {
    method: "POST",
    headers: { ...browser.web, "content-type": "application/json" },
    body: JSON.stringify({
      deviceKey: toBase64(deviceKey),
      historyKey: toBase64(crypto.getRandomValues(new Uint8Array(32))),
    }),
  });
  expect(started.status).toBe(200);
  const { linkId } = (await started.json()) as { linkId: string };
  const approved = await fetch(`/v1/devices/link-requests/${linkId}/approve`, {
    method: "POST",
    headers: { ...phone.auth, "content-type": "application/json" },
    body: JSON.stringify({ signature: toBase64(await phone.approve(linkId, deviceKey)) }),
  });
  expect(approved.status).toBe(204);
  if (!complete) return { phone, browser, linkId, linked: null };
  const completed = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
    method: "POST",
    headers: browser.web,
  });
  expect(completed.status).toBe(200);
  const { deviceId, token } = (await completed.json()) as { deviceId: string; token: string };
  return {
    phone,
    browser,
    linkId,
    linked: { deviceId, auth: { authorization: `Bearer ${token}` } },
  };
}

const history = (linkId: string, rest = "") => `/v1/devices/link-requests/${linkId}/history${rest}`;

function start(linkId: string, auth: Record<string, string>, size: number) {
  return fetch(history(linkId), {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ size }),
  });
}

function putPart(linkId: string, auth: Record<string, string>, part: number, body: Uint8Array) {
  return fetch(history(linkId, `/parts/${part}`), {
    method: "PUT",
    headers: { ...auth, "content-type": "application/octet-stream" },
    body,
  });
}

const complete = (linkId: string, auth: Record<string, string>) =>
  fetch(history(linkId, "/complete"), { method: "POST", headers: auth });

/** Uploads `blob` in one part and completes it, as the link's phone. */
async function upload(linkId: string, auth: Record<string, string>, blob: Uint8Array) {
  expect((await start(linkId, auth, blob.length)).status).toBe(201);
  expect((await putPart(linkId, auth, 1, blob)).status).toBe(204);
  expect((await complete(linkId, auth)).status).toBe(204);
}

const errorOf = async (r: Response) => ApiError.parse(await r.json()).error;

describe("a history transfer (decision 0064, #300)", () => {
  it("goes from the approving phone to the linked device, which deletes it once it has it", async () => {
    const { phone, linkId, linked } = await approvedLink();
    const blob = sealedHistory(200_000);

    const started = await start(linkId, phone.auth, blob.length);
    expect(started.status).toBe(201);
    expect(await started.json()).toMatchObject({ partSize: PART_SIZE, parts: 1 });
    expect((await putPart(linkId, phone.auth, 1, blob)).status).toBe(204);
    // A repeated part replaces the first, so a broken upload can be retried.
    expect((await putPart(linkId, phone.auth, 1, blob)).status).toBe(204);
    expect((await complete(linkId, phone.auth)).status).toBe(204);

    const got = await fetch(history(linkId), { headers: linked!.auth });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-length")).toBe(String(blob.length));
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(blob);
    // A download that broke can be repeated until the device deletes it.
    expect((await fetch(history(linkId), { headers: linked!.auth })).status).toBe(200);

    expect((await fetch(history(linkId), { method: "DELETE", headers: linked!.auth })).status).toBe(
      204,
    );
    expect(await env.MEDIA.head(`history/${linkId}`)).toBeNull();
    expect((await fetch(history(linkId), { headers: linked!.auth })).status).toBe(404);
    const rows = await env.DB.prepare(
      "SELECT count(*) AS n FROM history_transfers WHERE link_id = ?",
    )
      .bind(linkId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("answers a Range with that slice of the ciphertext (decision 0081)", async () => {
    const { phone, linkId, linked } = await approvedLink();
    const blob = sealedHistory(1000);
    await upload(linkId, phone.auth, blob);
    const ranged = (range?: string) =>
      fetch(history(linkId), { headers: { ...linked!.auth, ...(range ? { range } : {}) } });

    const head = await ranged("bytes=0-9");
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 0-9/1000");
    expect(head.headers.get("content-length")).toBe("10");
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await head.arrayBuffer())).toEqual(blob.slice(0, 10));

    const rest = await ranged("bytes=10-");
    expect(rest.status).toBe(206);
    expect(rest.headers.get("content-range")).toBe("bytes 10-999/1000");
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(blob.slice(10));

    // An end past the last byte is clamped to it.
    const clamped = await ranged("bytes=990-5000");
    expect(clamped.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect(new Uint8Array(await clamped.arrayBuffer())).toEqual(blob.slice(990));

    for (const bad of ["bytes=999999-", "bytes=1000-", "bytes=0-1,5-6", "bytes=9-3", "bytes=x-y"]) {
      const refused = await ranged(bad);
      expect(refused.status, bad).toBe(416);
      expect(refused.headers.get("content-range"), bad).toBe("bytes */1000");
    }

    // Another unit is ignored, as is no Range at all.
    for (const range of [undefined, "items=0-3"]) {
      const whole = await ranged(range);
      expect(whole.status).toBe(200);
      expect(whole.headers.get("accept-ranges")).toBe("bytes");
      expect(new Uint8Array(await whole.arrayBuffer())).toEqual(blob);
    }
  });

  it("may start before the browser completes the link, and reaches the device it then makes", async () => {
    const { phone, browser, linkId } = await approvedLink({ complete: false });
    await upload(linkId, phone.auth, sealedHistory(1000));
    const completed = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
      method: "POST",
      headers: browser.web,
    });
    const { token } = (await completed.json()) as { token: string };
    const got = await fetch(history(linkId), { headers: { authorization: `Bearer ${token}` } });
    expect(got.status).toBe(200);
  });

  it("is uploaded only by the approving phone, and read only by the device the link made", async () => {
    const { phone, linkId, linked } = await approvedLink();
    const sibling = await device({ accountId: phone.accountId });
    const stranger = await device();

    // Another phone of the same account did not approve this link.
    const bySibling = await start(linkId, sibling.auth, 1000);
    expect(bySibling.status).toBe(403);
    expect(await errorOf(bySibling)).toBe("not_this_device");
    // Another account's device does not learn the link exists.
    expect((await start(linkId, stranger.auth, 1000)).status).toBe(403);
    // The linked device does not upload to itself.
    expect((await start(linkId, linked!.auth, 1000)).status).toBe(403);
    expect((await start("lnk_unknown", phone.auth, 1000)).status).toBe(404);

    await upload(linkId, phone.auth, sealedHistory(1000));
    expect((await putPart(linkId, sibling.auth, 1, bytes(1000))).status).toBe(403);
    expect((await fetch(history(linkId), { headers: phone.auth })).status).toBe(403);
    expect((await fetch(history(linkId), { headers: sibling.auth })).status).toBe(403);
    expect((await fetch(history(linkId), { headers: stranger.auth })).status).toBe(403);
    expect(
      (await fetch(history(linkId), { method: "DELETE", headers: stranger.auth })).status,
    ).toBe(403);
    // A browser session alone is not a device.
    expect((await fetch(history(linkId), { headers: (await webSession()).web })).status).toBe(401);
  });

  it("is refused once the approving phone is revoked, and stops with the linked device", async () => {
    const first = await approvedLink({ complete: false });
    await revoke(first.phone.deviceId);
    expect((await start(first.linkId, first.phone.auth, 1000)).status).toBe(401);

    const second = await approvedLink();
    await upload(second.linkId, second.phone.auth, sealedHistory(1000));
    await revoke(second.linked!.deviceId);
    // With the device it made revoked, the link is no more, for its phone as for anyone.
    expect(
      (await fetch(history(second.linkId), { method: "DELETE", headers: second.phone.auth }))
        .status,
    ).toBe(204);
    expect((await start(second.linkId, second.phone.auth, 1000)).status).toBe(404);
  });

  it("is one per link, at most 1 GiB of history, and complete only with every part", async () => {
    const { phone, linkId } = await approvedLink();
    const tooLarge = await start(linkId, phone.auth, MAX_HISTORY_CIPHERTEXT + 1);
    expect(tooLarge.status).toBe(413);
    expect(await errorOf(tooLarge)).toBe("too_large");

    const size = 2 * PART_SIZE + 10;
    const started = await start(linkId, phone.auth, size);
    expect(await started.json()).toMatchObject({ parts: 3 });
    expect((await start(linkId, phone.auth, size)).status).toBe(409);

    // No such part, and a part of the wrong length, are refused before R2.
    expect((await putPart(linkId, phone.auth, 4, bytes(10))).status).toBe(400);
    expect((await putPart(linkId, phone.auth, 3, bytes(11))).status).toBe(400);
    expect((await putPart(linkId, phone.auth, 1, bytes(10))).status).toBe(400);
    expect((await putPart(linkId, phone.auth, 3, bytes(10))).status).toBe(204);

    const early = await complete(linkId, phone.auth);
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toBe("incomplete");
  });

  it("joins parts in order into one object", async () => {
    const { phone, linkId, linked } = await approvedLink();
    // A full part does not fit the test Worker's heap as one buffer, so the
    // parts are streamed from one 64 KiB chunk and compared by digest.
    const chunk = sealedHistory(65536);
    const size = PART_SIZE + 4096;
    const stream = (from: number, to: number) => {
      const { readable, writable } = new FixedLengthStream(to - from);
      void (async () => {
        const writer = writable.getWriter();
        for (let at = from; at < to;) {
          const offset = at % chunk.length;
          const end = Math.min(to - at, chunk.length - offset);
          await writer.write(chunk.slice(offset, offset + end));
          at += end;
        }
        await writer.close();
      })();
      return readable;
    };
    const digest = async (body: ReadableStream<Uint8Array>) => {
      const hash = new crypto.DigestStream("SHA-256");
      await body.pipeTo(hash);
      return toBase64(new Uint8Array(await hash.digest));
    };
    const put = (part: number, body: ReadableStream<Uint8Array>) =>
      fetch(history(linkId, `/parts/${part}`), { method: "PUT", headers: phone.auth, body });

    expect((await start(linkId, phone.auth, size)).status).toBe(201);
    // Out of order on purpose: the parts are numbered, not sequenced.
    expect((await put(2, stream(PART_SIZE, size))).status).toBe(204);
    expect((await put(1, stream(0, PART_SIZE))).status).toBe(204);
    expect((await complete(linkId, phone.auth)).status).toBe(204);
    expect((await complete(linkId, phone.auth)).status).toBe(409);
    const got = await fetch(history(linkId), { headers: linked!.auth });
    expect(got.headers.get("content-length")).toBe(String(size));
    expect(await digest(got.body!)).toBe(await digest(stream(0, size)));
  }, 120_000);

  it("holds only ciphertext: the stored object is the core's framing, and no route takes a key", async () => {
    const { phone, linkId } = await approvedLink();
    await upload(linkId, phone.auth, sealedHistory(4096));
    const stored = await env.MEDIA.get(`history/${linkId}`);
    const head = new Uint8Array(await stored!.arrayBuffer()).subarray(0, 5);
    expect(new TextDecoder().decode(head.subarray(0, 4))).toBe("SPJH");
    expect(head[4]).toBe(1);

    // The only key the server sees is the public half the browser put in the
    // link request; no history route or column takes a secret key.
    const spec = createApp().getOpenAPI31Document(DOCUMENT_INFO);
    const routes = Object.entries(spec.paths ?? {}).filter(([path]) => path.includes("/history"));
    expect(routes.length).toBeGreaterThan(0);
    expect(JSON.stringify(routes)).not.toMatch(/key/i);
    const { results } = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('history_transfers') UNION ALL SELECT name FROM pragma_table_info('history_transfer_parts')",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).filter((n) => /key/i.test(n))).toEqual([]);
  });

  it("is gone 24 hours after it starts, finished or not", async () => {
    const done = await approvedLink();
    await upload(done.linkId, done.phone.auth, sealedHistory(1000));
    const half = await approvedLink();
    expect((await start(half.linkId, half.phone.auth, 1000)).status).toBe(201);

    expect(await expireHistory(env)).toBe(0);
    const later = Date.now() + TRANSFER_MS + 1;
    await env.DB.prepare("UPDATE history_transfers SET expires_at = ? WHERE link_id IN (?, ?)")
      .bind(Date.now() - 1, done.linkId, half.linkId)
      .run();
    const late = await fetch(history(done.linkId), { headers: done.linked!.auth });
    expect(late.status).toBe(410);
    expect(await errorOf(late)).toBe("expired");
    expect((await putPart(half.linkId, half.phone.auth, 1, bytes(1000))).status).toBe(410);

    expect(await expireHistory(env, later)).toBeGreaterThanOrEqual(2);
    expect(await env.MEDIA.head(`history/${done.linkId}`)).toBeNull();
    expect((await fetch(history(done.linkId), { headers: done.linked!.auth })).status).toBe(404);
  });

  it("cannot start more than a day after the approval", async () => {
    const { phone, linkId, linked } = await approvedLink();
    await env.DB.prepare("UPDATE devices SET created_at = ? WHERE device_id = ?")
      .bind(Date.now() - TRANSFER_MS - 1, linked!.deviceId)
      .run();
    const late = await start(linkId, phone.auth, 1000);
    expect(late.status).toBe(410);
    expect(await errorOf(late)).toBe("expired");
  });

  it("answers a device that did not approve the link 403, however old the approval", async () => {
    const { linkId, linked } = await approvedLink();
    await env.DB.prepare("UPDATE devices SET created_at = ? WHERE device_id = ?")
      .bind(Date.now() - TRANSFER_MS - 1, linked!.deviceId)
      .run();
    const other = await approvedLink();
    const refused = await start(linkId, other.phone.auth, 1000);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_this_device");
  });

  it("goes with its account, bytes and all", async () => {
    const { phone, linkId } = await approvedLink();
    await upload(linkId, phone.auth, sealedHistory(1000));
    const half = await approvedLink();
    expect((await start(half.linkId, half.phone.auth, 1000)).status).toBe(201);
    expect(await deleteAccountHistory(env, "acct_nobody")).toBe(0);

    await deleteAccount(euEnv(env), phone.accountId);
    expect(await env.MEDIA.head(`history/${linkId}`)).toBeNull();
    const rows = await env.DB.prepare(
      "SELECT link_id FROM history_transfers WHERE link_id IN (?, ?)",
    )
      .bind(linkId, half.linkId)
      .all<{ link_id: string }>();
    expect(rows.results.map((r) => r.link_id)).toEqual([half.linkId]);
  });

  it("can be cancelled by the phone that uploads it", async () => {
    const { phone, linkId, linked } = await approvedLink();
    expect((await start(linkId, phone.auth, 1000)).status).toBe(201);
    expect((await fetch(history(linkId), { method: "DELETE", headers: phone.auth })).status).toBe(
      204,
    );
    expect((await fetch(history(linkId), { headers: linked!.auth })).status).toBe(404);
    // The link may then carry a fresh transfer.
    expect((await start(linkId, phone.auth, 1000)).status).toBe(201);
  });
});
