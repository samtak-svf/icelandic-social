import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { conversation, inbox } from "../src/env/index.ts";

// Local workerd does not implement jurisdictions (`jurisdiction()` throws "not
// implemented"), so the namespaces are wrapped: the wrapper records the
// jurisdiction asked for and hands back the real namespace, and every other
// method on it throws. A stub made any other way than `.jurisdiction("eu")`
// fails here; tooling/seam-guard.mjs keeps stubs out of every other module.
function euOnly<N extends object>(real: N) {
  const asked: string[] = [];
  const bare = () => {
    throw new Error("stub made without a jurisdiction");
  };
  const namespace = {
    jurisdiction(jurisdiction: string) {
      asked.push(jurisdiction);
      return real;
    },
    idFromName: bare,
    idFromString: bare,
    newUniqueId: bare,
    get: bare,
    getByName: bare,
  } as unknown as N;
  return { namespace, asked };
}

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

  it("fails when a stub skips the jurisdiction", () => {
    const { namespace } = euOnly(env.CONVERSATION);
    expect(() => (namespace as DurableObjectNamespace).getByName("conv-1")).toThrow(
      /without a jurisdiction/,
    );
  });
});
