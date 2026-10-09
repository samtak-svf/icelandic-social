import { withFakes } from "./oidc.ts";
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
// - it serves the fake Kenni and Google (dev/oidc.ts) under /dev/kenni and
//   /dev/google and reaches them in process; the interop mode sets
//   KENNI_ISSUER, GOOGLE_ISSUER and GOOGLE_CLIENT_ID to them;
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
    const fakes = withFakes(request, env);
    if (fakes.response) return fakes.response;
    if (url.pathname === OPERATOR_INVITE_PATH && request.method === "POST") {
      const { link, sql } = await operatorInvite();
      await env.DB.prepare(sql).run();
      return new Response(link);
    }
    return worker.fetch(request, { ...devEnv(env), ...fakes.env }, ctx);
  },
} satisfies ExportedHandler<Env>;
