import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { nameKey } from "../src/profiles.ts";
import { device, revoke } from "./support.ts";
import { worker } from "./main.ts";

// The directory of people (decision 0036): every other signed-in account,
// verified first and then by name, searched without case or the Icelandic
// letters; never the caller, an account without a device, or one either side
// blocked.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

type Device = Awaited<ReturnType<typeof device>>;
type Person = { accountId: string; name: string | null; verified: boolean };
type Page = { people: Person[]; next: string | null };

async function named(name: string | null, verified = false) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = ? WHERE account_id = ?")
    .bind(name, verified ? 1 : 0, seeded.accountId)
    .run();
  return seeded;
}

async function people(by: Device, query = "") {
  const response = await fetch(`/v1/people${query}`, { headers: by.auth });
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

/** The names a page shows, of the accounts in `among` only: the tests share one D1. */
const namesOf = (page: Page, among: Device[]) =>
  page.people.filter((p) => among.some((d) => d.accountId === p.accountId)).map((p) => p.name);

describe("GET /v1/people", () => {
  it("lists every other signed-in account, verified first, then by name", async () => {
    const me = await named("Ég Prófsson");
    const others = [
      await named("Örn Listason"),
      await named("Bára Listadóttir", true),
      await named("Ari Listason"),
      await named("Þóra Listadóttir", true),
    ];
    const page = await people(me, "?q=lista");
    expect(namesOf(page, [me, ...others])).toEqual([
      "Bára Listadóttir",
      "Þóra Listadóttir",
      "Ari Listason",
      "Örn Listason",
    ]);
    expect(page.people.find((p) => p.name === "Bára Listadóttir")?.verified).toBe(true);
  });

  it("finds a name typed without the Icelandic letters, in any case", async () => {
    const me = await named("Ég Prófsson");
    const target = await named("Guðröður Þæfingsson");
    for (const q of ["gudrodur", "GUÐRÖÐUR", "thaefings", "Þæfings"]) {
      expect(namesOf(await people(me, `?q=${encodeURIComponent(q)}`), [target])).toEqual([
        "Guðröður Þæfingsson",
      ]);
    }
    expect(namesOf(await people(me, "?q=gudmundur"), [target])).toEqual([]);
  });

  it("takes % and _ in a search as themselves", async () => {
    const me = await named("Ég Prófsson");
    const plain = await named("Prósentulaus Jónsson");
    expect(namesOf(await people(me, `?q=${encodeURIComponent("%")}`), [plain])).toEqual([]);
    expect(namesOf(await people(me, "?q=_"), [plain])).toEqual([]);
  });

  it("leaves out the caller, the nameless and accounts with no device left", async () => {
    const me = await named("Sjálfur Útundanson");
    const nameless = await named(null);
    const gone = await named("Farinn Útundanson");
    await revoke(gone.deviceId);
    const page = await people(me, "?q=utundan");
    expect(namesOf(page, [me, nameless, gone])).toEqual([]);
    expect(page.people.some((p) => p.accountId === nameless.accountId)).toBe(false);
  });

  it("leaves out an account the caller blocked, and one that blocked the caller", async () => {
    const me = await named("Ég Bannsson");
    const blocked = await named("Lokaður Bannsson");
    const blocker = await named("Lokandi Bannsson");
    const friend = await named("Vinur Bannsson");
    const put = (by: Device, target: Device) =>
      fetch(`/v1/blocks/${target.accountId}`, { method: "PUT", headers: by.auth });
    expect((await put(me, blocked)).status).toBe(204);
    expect((await put(blocker, me)).status).toBe(204);
    expect(namesOf(await people(me, "?q=bannsson"), [blocked, blocker, friend])).toEqual([
      "Vinur Bannsson",
    ]);
  });

  it("pages through every account once, in order", async () => {
    const me = await named("Ég Síðuson");
    const all = [];
    for (const name of ["Síðu Fimm", "Síðu Einn", "Síðu Fjórir", "Síðu Tveir", "Síðu Þrír"]) {
      all.push(await named(name, name === "Síðu Þrír"));
    }
    const seen: (string | null)[] = [];
    let next: string | null = null;
    do {
      const page: Page = await people(
        me,
        `?q=sidu&limit=2${next ? `&after=${encodeURIComponent(next)}` : ""}`,
      );
      expect(page.people.length).toBeLessThanOrEqual(2);
      seen.push(...namesOf(page, all));
      next = page.next;
    } while (next);
    expect(seen).toEqual(["Síðu Þrír", "Síðu Einn", "Síðu Fimm", "Síðu Fjórir", "Síðu Tveir"]);
  });

  it("refuses a cursor it did not make", async () => {
    const me = await named("Ég Prófsson");
    for (const after of ["nope!", btoa('[2,"x","y"]'), btoa("{}")]) {
      const response = await fetch(`/v1/people?after=${encodeURIComponent(after)}`, {
        headers: me.auth,
      });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("needs a device token", async () => {
    expect((await fetch("/v1/people")).status).toBe(401);
  });
});

describe("nameKey", () => {
  it("folds a search as the migration folds name_key", async () => {
    const names = ["ÁÐÉÍÓÚÝÞÆÖ áðéíóúýþæö", "Guðröður Atli", "Ægir Þór Ýmisson", "Plain Name"];
    for (const name of names) {
      const row = await env.DB.prepare("SELECT name_key AS key FROM accounts WHERE account_id = ?")
        .bind((await named(name)).accountId)
        .first<{ key: string }>();
      expect(row?.key).toBe(nameKey(name));
    }
  });
});
