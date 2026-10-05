import { DurableObject } from "cloudflare:workers";

/**
 * One conversation's MLS delivery service (plan §4): a monotonic `seq`, one
 * commit per epoch, ciphertext envelopes under a retention TTL. Phase 0 only
 * proves it is reachable through the EU-pinned stub in src/env/.
 */
export class Conversation extends DurableObject<Env> {
  async ping(): Promise<"pong"> {
    return "pong";
  }
}
