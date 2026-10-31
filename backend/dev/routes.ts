import worker from "../src/worker.ts";
import { OPERATOR_INVITE_PATH, operatorInvite } from "../scripts/operator-invite.ts";

// The routes the dev entries share, dev/worker.ts and dev/staging-app.ts. In
// production each of these is the maintainer's by hand or a cron's:
// - a POST to /dev/operator-invite writes an operator invite into D1 and answers
//   its link (decision 0019);
// - a POST to /dev/jobs runs the minute cron once (decision 0067);
// - a POST to /dev/platform-moderator?account=<id> makes that account a platform
//   moderator (decision 0063);
// - a POST to /dev/phone?account=<id> gives that account a device row, which a
//   person gets by installing the app, so it enters the directory and the
//   suggestions (backend/src/modules/profiles/profiles.ts). The row names a key
//   nobody holds, so it can read and send nothing.

const JOBS_PATH = "/dev/jobs";
const PLATFORM_MODERATOR_PATH = "/dev/platform-moderator";
const PHONE_PATH = "/dev/phone";

/** Answers a request for one of these routes, else null. */
export async function devRoute(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  if (url.pathname === OPERATOR_INVITE_PATH) {
    const { link, sql } = await operatorInvite();
    await env.DB.prepare(sql).run();
    return new Response(link);
  }
  if (url.pathname === PLATFORM_MODERATOR_PATH) {
    const account = url.searchParams.get("account");
    if (account === null) return new Response(null, { status: 400 });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO platform_moderators (account_id, added_at) VALUES (?, ?)",
    )
      .bind(account, Date.now())
      .run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === PHONE_PATH) {
    const account = url.searchParams.get("account");
    if (account === null) return new Response(null, { status: 400 });
    await env.DB.prepare(
      `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at)
       VALUES (?, ?, 'android', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        account,
        crypto.getRandomValues(new Uint8Array(32)),
        crypto.randomUUID(),
        Date.now(),
      )
      .run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === JOBS_PATH) {
    const cron = { cron: "* * * * *", scheduledTime: Date.now(), noRetry() {} };
    await worker.scheduled(cron, env);
    return new Response(null, { status: 204 });
  }
  return null;
}
