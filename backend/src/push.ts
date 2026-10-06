import { log } from "./log.ts";

// Push for a device with no open socket (decisions 0002, 0015, 0017). The
// payload is only the fetch hint: which conversation, and up to which seq.

export type PushSender = {
  send(push: { deviceId: string; conversationId: string; seq: number }): Promise<void>;
};

/**
 * The only sender until FCM and APNs are set up: it records that a push was
 * due. Its replacement reads the device's platform and push token from D1.
 */
const skipped: PushSender = {
  async send({ deviceId, conversationId, seq }) {
    log("push.skipped", { deviceId, conversationId, seq });
  },
};

export function pushSender(_env: Env): PushSender {
  return skipped;
}
