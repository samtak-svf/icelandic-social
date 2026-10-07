import { db, type PushConfig, pushConfig } from "../env/index.ts";
import { log } from "../log.ts";
import { type ApnsKey, sendApns } from "./apns.ts";
import { type FcmAccount, sendFcm } from "./fcm.ts";

// Push for a device with no open socket (decisions 0002, 0015, 0017, 0025).
// A push names nothing: the device syncs every conversation that is behind.

export type PushSender = {
  send(push: { deviceId: string }): Promise<void>;
};

/**
 * What a provider said. A dead token is cleared and not retried; a rejected
 * push is dropped. A send the provider may take later throws, and the
 * `Inbox` alarm tries it again.
 */
export type Outcome = { result: "sent" | "dead" | "rejected"; status: number };

/** The sender with no credentials: it records that a push was due. */
const skipped: PushSender = {
  async send({ deviceId }) {
    log("push.skipped", { deviceId });
  },
};

export function pushSender(env: Env): PushSender {
  const config = pushConfig(env);
  if (!config.fcm && !config.apns) return skipped;
  return sender(config, db(env));
}

type Target = { platform: string; token: string | null; sandbox: number };

/** Sends to the device's own token, FCM for Android and APNs for iOS. */
export function sender(config: PushConfig, database: D1Database): PushSender {
  const send = (target: Target & { token: string }, fcm?: FcmAccount, apns?: ApnsKey) => {
    if (target.platform === "android" && fcm) return sendFcm(fcm, target.token, config.fetch);
    if (target.platform === "ios" && apns) {
      return sendApns(apns, target.token, target.sandbox === 1, config.fetch);
    }
    return undefined;
  };
  return {
    async send({ deviceId }) {
      const target = await database
        .prepare(
          `SELECT platform, push_token AS token, push_sandbox AS sandbox
             FROM devices WHERE device_id = ? AND revoked_at IS NULL`,
        )
        .bind(deviceId)
        .first<Target>();
      if (!target?.token) {
        log("push.no_token", { deviceId });
        return;
      }
      const outcome = await send({ ...target, token: target.token }, config.fcm, config.apns);
      if (!outcome) {
        log("push.skipped", { deviceId, code: target.platform });
        return;
      }
      if (outcome.result === "dead") {
        await database
          .prepare("UPDATE devices SET push_token = NULL WHERE device_id = ? AND push_token = ?")
          .bind(deviceId, target.token)
          .run();
      }
      log(`push.${outcome.result}`, { deviceId, status: outcome.status });
    },
  };
}
