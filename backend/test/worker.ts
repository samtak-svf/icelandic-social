import { fakeKenni, fakeKenniFetcher, KENNI_PATH } from "../dev/kenni.ts";
import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";
import { euEnv } from "./support.ts";

// The Worker the tests run (vitest.config.ts `main`): src/index.ts with
// every Durable Object namespace behind `euOnly`, in the Worker and in each
// Durable Object, so a request or DO-to-DO call that makes a stub any other
// way than `.jurisdiction("eu")` fails. Production code is unchanged.
//
// It also serves the fake Kenni under /dev/kenni, which vitest.config.ts
// makes the issuer, and binds it so the Worker reaches it in process.

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
    if (new URL(request.url).pathname.startsWith(KENNI_PATH)) {
      return fakeKenni(request, env.KENNI_ISSUER);
    }
    const withFake = { ...euEnv(env), KENNI_FAKE: fakeKenniFetcher(env.KENNI_ISSUER) };
    return worker.fetch(request, withFake, ctx);
  },
} satisfies ExportedHandler<Env>;
