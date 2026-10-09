import { withFakes } from "../dev/oidc.ts";
import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";
import { euEnv } from "./support.ts";

// The Worker the tests run (vitest.config.ts `main`): src/index.ts with
// every Durable Object namespace behind `euOnly`, in the Worker and in each
// Durable Object, so a request or DO-to-DO call that makes a stub any other
// way than `.jurisdiction("eu")` fails. Production code is unchanged.
//
// It also serves the fake Kenni and Google (dev/oidc.ts), which
// vitest.config.ts makes the issuers, and binds them so the Worker reaches
// them in process.

export class Conversation extends RealConversation {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, euEnv(env));
  }
}

export class Inbox extends RealInbox {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, euEnv(env));
  }
}

export default {
  fetch(request, env, ctx) {
    const fakes = withFakes(request, env);
    if (fakes.response) return fakes.response;
    return worker.fetch(request, { ...euEnv(env), ...fakes.env }, ctx);
  },
} satisfies ExportedHandler<Env>;
