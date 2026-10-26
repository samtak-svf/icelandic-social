// The server's half of a browser's store key while its link request waits
// for the phone (decision 0096). The share is made with the request
// (`createLinkRequest`) and becomes the device's when the link completes.

import { toBase64 } from "../bytes.ts";
import { db } from "../env/index.ts";
import type { Session } from "./sessions.ts";

/** The store-key share of this session's own pending link request `linkId` (0096). */
export async function pendingStoreKeyShare(
  env: Env,
  session: Session,
  linkId: string,
  now = Date.now(),
): Promise<{ linkId: string; storeKeyShare: string; expiresAt: number } | null> {
  const row = await db(env)
    .prepare(
      `SELECT store_key_share AS storeKeyShare, expires_at AS expiresAt
         FROM device_link_requests
        WHERE link_id = ? AND session_id = ? AND account_id = ? AND expires_at > ?`,
    )
    .bind(linkId, session.sessionId, session.accountId, now)
    .first<{ storeKeyShare: ArrayBuffer | null; expiresAt: number }>();
  if (!row || !row.storeKeyShare) return null;
  return {
    linkId,
    storeKeyShare: toBase64(new Uint8Array(row.storeKeyShare)),
    expiresAt: row.expiresAt,
  };
}
