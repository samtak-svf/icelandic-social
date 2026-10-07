import { log } from "./log.ts";

// Push for a device with no open socket (decisions 0002, 0015, 0017, 0025).
// A push names nothing: the device syncs every conversation that is behind.

export type PushSender = {
  send(push: { deviceId: string }): Promise<void>;
};

/**
 * The only sender until FCM and APNs are set up: it records that a push was
 * due. Its replacement reads the device's platform and push token from D1.
 */
const skipped: PushSender = {
  async send({ deviceId }) {
    log("push.skipped", { deviceId });
  },
};

export function pushSender(_env: Env): PushSender {
  return skipped;
}
