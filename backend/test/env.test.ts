import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { conversation, inbox } from "../src/env/index.ts";
import { euOnly } from "./support.ts";

// tooling/seam-guard.mjs keeps stubs out of every module but src/env; this
// checks that the ones src/env makes are pinned to the EU (see euOnly).

describe("Durable Object stubs from src/env", () => {
  it("pins a conversation to the EU and reaches it", async () => {
    const { namespace, asked } = euOnly(env.CONVERSATION);
    const stub = conversation({ ...env, CONVERSATION: namespace }, "conv-1");
    expect(asked).toEqual(["eu"]);
    expect(await stub.ping()).toBe("pong");
  });

  it("pins an inbox to the EU and reaches it", async () => {
    const { namespace, asked } = euOnly(env.INBOX);
    const stub = inbox({ ...env, INBOX: namespace }, "acct-1");
    expect(asked).toEqual(["eu"]);
    expect(await stub.ping()).toBe("pong");
  });

  it("refuses a jurisdiction other than the EU", () => {
    const { namespace } = euOnly(env.CONVERSATION);
    expect(() => (namespace as DurableObjectNamespace).jurisdiction("fedramp")).toThrow(/not eu/);
  });

  it("fails when a stub skips the jurisdiction", () => {
    const { namespace } = euOnly(env.CONVERSATION);
    expect(() => (namespace as DurableObjectNamespace).getByName("conv-1")).toThrow(
      /without a jurisdiction/,
    );
  });
});
