import type { OpenAPIHono } from "@hono/zod-openapi";
import { deleteGroupPhotoRoute, getGroupPhotoRoute, putGroupPhotoRoute } from "../../api/media.ts";
import type { AppEnv } from "../../http.ts";
import { conversation } from "../../env/index.ts";
import { fail } from "../../shared/errors.ts";
import { deleteGroupPhoto, getGroupPhoto, MAX_GROUP_PHOTO, putGroupPhoto } from "./group-photos.ts";

// A group's photo (decision 0094): set, read and cleared only by a member, as
// media is (0023). Nothing here logs: a line must not pair the photo with an account (0008).

export function groupPhotoRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(putGroupPhotoRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(fail(c, 400, "invalid_request"));
    }
    if (length > MAX_GROUP_PHOTO) return refuse(fail(c, 413, "too_large"));
    const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? refuse(fail(c, 404, member.error))
        : refuse(fail(c, 403, "not_a_member"));
    }
    try {
      await putGroupPhoto(c.env, conversationId, mediaId, length, body);
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    return c.body(null, 204);
  });

  app.openapi(getGroupPhotoRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? fail(c, 404, member.error)
        : fail(c, 403, "not_a_member");
    }
    const object = await getGroupPhoto(c.env, conversationId, mediaId);
    if (!object) return fail(c, 404, "not_found");
    return c.body(object.body, 200, {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
    });
  });

  app.openapi(deleteGroupPhotoRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? fail(c, 404, member.error)
        : fail(c, 403, "not_a_member");
    }
    await deleteGroupPhoto(c.env, conversationId);
    return c.body(null, 204);
  });
}
