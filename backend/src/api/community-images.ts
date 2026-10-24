import { createRoute, z } from "@hono/zod-openapi";
import { MAX_PHOTO_UPLOAD } from "./accounts.ts";
import { community, json, NOT_FOUND, MODERATORS_ONLY } from "./communities.ts";
import { Framing, FRAME_NAMES } from "./image-frames.ts";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";

// A community's picture and cover (decision 0080): the account photo's path
// with another size and key. Written by the owner and the moderators, read by
// whoever may read the community.

const Binary = z.string().openapi({ type: "string", format: "binary" });

const imageRoutes = (
  which: "avatar" | "cover",
  noun: string,
  size: string,
  frames: readonly string[],
) => {
  const Which = which === "avatar" ? "Avatar" : "Cover";
  const Set = z
    .object({ version: OpaqueId.openapi({ description: `The new ${noun}'s version` }) })
    .openapi(`Community${Which}Set`);
  const base = {
    tags: ["communities"],
    security: ACCOUNT,
    request: { params: community },
  };
  return {
    put: createRoute({
      ...base,
      method: "put",
      path: `/v1/communities/{communityId}/${which}`,
      operationId: `setCommunity${Which}`,
      summary: `Set or replace a community's ${noun} (decision 0080)`,
      description:
        `The body is an image (JPEG, PNG, WebP, GIF or AVIF) of at most ${MAX_PHOTO_UPLOAD / 1024 / 1024} MB, with a ` +
        `Content-Length. The server re-encodes it to a ${size} WebP without metadata and keeps ` +
        `only that. Only the community's owner and its moderators may; the change is a ` +
        `moderation log entry. It is not end-to-end encrypted.`,
      request: {
        params: community,
        body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
      },
      responses: {
        200: json("Stored", Set),
        400: errorResponse(
          "invalid_request: no Content-Length, or a body of another length; " +
            "invalid_image: not an image the server can decode",
        ),
        413: errorResponse("too_large: more than 10 MB"),
        ...MODERATORS_ONLY,
        ...NOT_FOUND,
        ...RATE_LIMITED,
        ...AUTHED,
      },
    }),
    patch: createRoute({
      ...base,
      method: "patch",
      path: `/v1/communities/{communityId}/${which}/frames`,
      operationId: `setCommunity${Which}Frames`,
      summary: `Frame a community's ${noun} again, from its stored master (decision 0086)`,
      description:
        "The body is the focus and any rectangle set by hand. The server cuts the frames again " +
        "from the master it kept and gives the image a new version. Only the community's owner " +
        "and its moderators may; the change is a moderation log entry, as for an upload.",
      request: {
        params: community,
        body: { required: true, content: { "application/json": { schema: Framing } } },
      },
      responses: {
        200: json("Framed", Set),
        400: errorResponse(
          `invalid_request: the body is not a framing, or names a frame a ${noun} does not have`,
        ),
        404: errorResponse(`not_found: no such community, or it has no ${noun}`),
        409: errorResponse(
          `no_master: the ${noun} was uploaded before masters were kept; upload it again to frame it`,
        ),
        ...MODERATORS_ONLY,
        ...RATE_LIMITED,
        ...AUTHED,
      },
    }),
    source: createRoute({
      ...base,
      method: "get",
      path: `/v1/communities/{communityId}/${which}/source`,
      operationId: `getCommunity${Which}Source`,
      summary: `A community's ${noun} master, to frame it again (decision 0086)`,
      description:
        "A WebP without metadata, at most 2400 px on its long edge. Only the community's owner and its moderators read it.",
      responses: {
        200: { description: "The master", content: { "image/webp": { schema: Binary } } },
        404: errorResponse(
          `not_found: no such community, no ${noun}, one stored before masters were kept, or the caller may not change it`,
        ),
        ...INVALID,
        ...AUTHED,
      },
    }),
    delete: createRoute({
      ...base,
      method: "delete",
      path: `/v1/communities/{communityId}/${which}`,
      operationId: `removeCommunity${Which}`,
      summary: `Remove a community's ${noun} (decision 0080)`,
      description:
        "Only the community's owner and its moderators may; the change is a moderation log entry.",
      responses: {
        204: { description: `No ${noun}, whether there was one or not` },
        ...MODERATORS_ONLY,
        ...NOT_FOUND,
        ...INVALID,
        ...AUTHED,
      },
    }),
    get: createRoute({
      ...base,
      method: "get",
      path: `/v1/communities/{communityId}/${which}`,
      request: {
        params: community,
        query: z.object({
          frame: z
            .enum(frames as [string, ...string[]])
            .optional()
            .openapi({
              description: `The frame to serve, one of ${frames.join(", ")}; without it the one an app from before decision 0086 knows`,
            }),
        }),
      },
      operationId: `getCommunity${Which}`,
      summary: `A community's ${noun}, a ${size} WebP (decision 0080)`,
      description:
        "An open community's is readable by any signed-in account; a private community's only by its members.",
      responses: {
        200: { description: `The ${noun}`, content: { "image/webp": { schema: Binary } } },
        ...INVALID,
        404: errorResponse(
          `not_found: no such community, no ${noun}, or the caller may not read the community`,
        ),
        ...AUTHED,
      },
    }),
  };
};

const avatar = imageRoutes("avatar", "picture", "512 by 512", FRAME_NAMES.photo);
const cover = imageRoutes("cover", "cover", "1600 by 600", FRAME_NAMES.cover);
export const putCommunityAvatarRoute = avatar.put;
export const deleteCommunityAvatarRoute = avatar.delete;
export const getCommunityAvatarRoute = avatar.get;
export const patchCommunityAvatarFramesRoute = avatar.patch;
export const getCommunityAvatarSourceRoute = avatar.source;
export const putCommunityCoverRoute = cover.put;
export const deleteCommunityCoverRoute = cover.delete;
export const getCommunityCoverRoute = cover.get;
export const patchCommunityCoverFramesRoute = cover.patch;
export const getCommunityCoverSourceRoute = cover.source;
