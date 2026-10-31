import type { Context } from "hono";
import { MAX_SOCIAL_UPLOAD } from "../../api/social.ts";
import { withinLimit } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { log } from "../../shared/log.ts";
import { upload } from "./media.ts";

type Refused =
  | { status: 429; error: "rate_limited" }
  | { status: 400; error: "invalid_request" | "invalid_image" }
  | { status: 413; error: "too_large" };

type Stored = Exclude<Awaited<ReturnType<typeof upload>>, "invalid_image">;

/**
 * Stores the request's body as an image of `communityId`, once the caller has
 * been let in. A refusal cancels the body, so the client stops sending it.
 */
export async function storedUpload(
  c: Context<AppEnv>,
  communityId: string,
  accountId: string,
): Promise<Stored | Refused> {
  const body = c.req.raw.body;
  const refuse = async (answer: Refused) => (await body?.cancel(), answer);
  if (!(await withinLimit(c.env, "photos", `social:${accountId}`))) {
    log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
    return refuse({ status: 429, error: "rate_limited" });
  }
  const length = Number(c.req.header("content-length") ?? Number.NaN);
  if (!Number.isSafeInteger(length) || length < 1 || !body) {
    return refuse({ status: 400, error: "invalid_request" });
  }
  if (length > MAX_SOCIAL_UPLOAD) return refuse({ status: 413, error: "too_large" });
  let stored: Awaited<ReturnType<typeof upload>>;
  try {
    stored = await upload(c.env, communityId, accountId, body, length);
  } catch {
    // The body ended short of, or ran past, its Content-Length.
    return { status: 400, error: "invalid_request" };
  }
  if (stored === "invalid_image") return { status: 400, error: "invalid_image" };
  log("social_media.stored", { accountId, communityId, size: length });
  return stored;
}
