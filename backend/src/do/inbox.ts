import { DurableObject } from "cloudflare:workers";

/**
 * One account's devices (plan §4): a hibernating WebSocket per device, the
 * "conversation X at seq N" notifications, Welcome routing, and push when a
 * device is offline. Phase 0 only proves it is reachable through src/env/.
 */
export class Inbox extends DurableObject<Env> {
  async ping(): Promise<"pong"> {
    return "pong";
  }
}
