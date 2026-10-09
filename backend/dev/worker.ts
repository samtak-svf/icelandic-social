import { fakeKenni, fakeKenniFetcher, KENNI_PATH } from "./kenni.ts";
import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";
import { OPERATOR_INVITE_PATH, operatorInvite } from "../scripts/operator-invite.ts";

// The Worker that `cf dev --mode interop` runs for the interop test
// (core/client/tests/backend.rs). Never deployed: every other mode's entry is
// src/index.ts (cloudflare.config.ts), and `jurisdiction-check.mjs --deploy`
// refuses any other.
//
// It differs from the real Worker in these ways only:
// - local workerd throws on `jurisdiction()`, so each namespace answers
//   `.jurisdiction("eu")` with itself (test/worker.ts refuses anything else);
// - it serves the fake Kenni (dev/kenni.ts) under /dev/kenni and reaches it in
//   process; the interop mode sets KENNI_ISSUER to it;
// - a POST to /dev/operator-invite writes an operator invite into the local D1
//   and answers its link (scripts/invite-operator.ts --local), since cf has no
//   local `d1 query`.

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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(KENNI_PATH)) return fakeKenni(request, env.KENNI_ISSUER);
    if (url.pathname === OPERATOR_INVITE_PATH && request.method === "POST") {
      const { link, sql } = await operatorInvite();
      await env.DB.prepare(sql).run();
      return new Response(link);
    }
    const withFake = { ...devEnv(env), KENNI_FAKE: fakeKenniFetcher(env.KENNI_ISSUER) };
    return worker.fetch(request, withFake, ctx);
  },
} satisfies ExportedHandler<Env>;
