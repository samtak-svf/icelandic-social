import { fakeKenni, fakeKenniFetcher, KENNI_PATH } from "./kenni.ts";
import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";

// The Worker that `wrangler dev dev/worker.ts` runs for the interop test
// (core/client/tests/backend.rs). Never deployed: `wrangler deploy` reads
// `main` from wrangler.jsonc, which stays src/index.ts.
//
// It differs from the real Worker in these ways only:
// - local workerd throws on `jurisdiction()`, so each namespace answers
//   `.jurisdiction("eu")` with itself (test/worker.ts refuses anything else);
// - it serves the fake Kenni (dev/kenni.ts) under /dev/kenni and reaches it in
//   process; run it with `--var KENNI_ISSUER:<this origin>/dev/kenni`.

function local(namespace: DurableObjectNamespace): DurableObjectNamespace {
  return new Proxy(namespace, {
    get(target, key) {
      if (key === "jurisdiction") {
        return (jurisdiction: string) => {
          if (jurisdiction !== "eu") throw new Error(`stub pinned to ${jurisdiction}, not eu`);
          return target;
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function devEnv(env: Env): Env {
  return {
    ...env,
    CONVERSATION: local(env.CONVERSATION) as Env["CONVERSATION"],
    INBOX: local(env.INBOX) as Env["INBOX"],
  };
}

export class Conversation extends RealConversation {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, devEnv(env));
  }
}

export class Inbox extends RealInbox {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, devEnv(env));
  }
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(KENNI_PATH)) return fakeKenni(request, env.KENNI_ISSUER);
    const withFake = { ...devEnv(env), KENNI_FAKE: fakeKenniFetcher(env.KENNI_ISSUER) };
    return worker.fetch(request, withFake, ctx);
  },
} satisfies ExportedHandler<Env>;
