import type { Context } from "hono";
import { MAX_SOCIAL_UPLOAD } from "../../api/social.ts";
import type { AppEnv } from "../../http.ts";
import { takeUpload, type UploadRefusal } from "../../shared/images.ts";
import { log } from "../../shared/log.ts";
import { upload } from "./media.ts";

type Refused = UploadRefusal | { status: 400; error: "invalid_image" };

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
  // Its own key: a post's images do not spend the account's photo allowance.
  const taken = await takeUpload(c, accountId, MAX_SOCIAL_UPLOAD, `social:${accountId}`);
  if ("error" in taken) return taken;
  const { body, length } = taken;
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
