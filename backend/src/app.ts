import { OpenAPIHono } from "@hono/zod-openapi";
import { deleteAccount } from "./compose/account-deletion.ts";
import { linkOrJoin } from "./compose/account-linking.ts";
import { communityLifecycle } from "./compose/community-lifecycle.ts";
import { blockAccount } from "./compose/friends.ts";
import { WsFrame } from "./api/frames.ts";
import { FRAME_SPECS, SIZE_CLASSES } from "./api/image-frames.ts";
import { healthRoute } from "./api/health.ts";
import { clientFloor } from "./shared/client-version.ts";
import { guards, registerSchemes } from "./shared/credentials.ts";
import { drainBody, fail, failed, requestId } from "./shared/errors.ts";
import { minClientVersions, updateUrls } from "./env/index.ts";
import type { AppEnv } from "./http.ts";
import {
  identityRoutes,
  inviteRoutes,
  linkedDeviceRoutes,
  linkHost,
  sessionRoutes,
  webSignInRoutes,
} from "./identity/index.ts";
import { communityRoutes } from "./modules/communities/index.ts";
import { historyRoutes } from "./modules/history/index.ts";
import { importRoutes } from "./modules/imports/index.ts";
import { messagingRoutes } from "./modules/messaging/index.ts";
import { moderationRoutes } from "./modules/moderation/index.ts";
import { notificationRoutes, withdrawingRequestNotice } from "./modules/notifications/index.ts";
import { accountRoutes, photoRoutes } from "./modules/profiles/index.ts";
import { friendRoutes } from "./modules/friends/index.ts";
import { socialRoutes } from "./modules/social/index.ts";
import { opsRoutes } from "./ops/index.ts";

/**
 * OpenAPI 3.1 document metadata; the routes and schemas come from src/api/.
 * `x-frame-specs` is the pixel size of every image frame (decision 0086),
 * for the clients that cut previews and for `tooling/frames-check.mjs`;
 * `x-size-classes` is where each window size class begins (decisions 0086,
 * 0087), the one definition every client's layout keys off.
 */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
  "x-frame-specs": FRAME_SPECS,
  "x-size-classes": SIZE_CLASSES,
} as const;

/**
 * Composes the Worker's app: the middleware, then each module's routes. A
 * route lives in the module that owns it, and a module is mounted by one
 * function from its index.ts. Registration order is the order api/openapi.json
 * lists the paths in. AppEnv, the Hono env every handler sees, is in http.ts.
 */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return fail(c, 400, "invalid_request");
    },
  });
  app.onError(failed);
  app.notFound((c) => fail(c, 404, "not_found"));

  registerSchemes(app);
  const { publicLimit, credentials } = guards(app);
  app.use("*", drainBody);
  app.use("*", requestId);
  app.use("/v1/*", clientFloor);
  app.use("/v1/*", publicLimit);
  app.use("/v1/*", credentials);

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok" as const,
        minClientVersion: minClientVersions(c.env),
        updateUrl: updateUrls(c.env),
      },
      200,
    ),
  );

  // Sign-in, devices, the caller's account and KeyPackages (decisions 0017, 0019).
  // Deleting an account and a merging link reach every module, so they come from here.
  identityRoutes(app, { deleteAccount, linkOrJoin });
  inviteRoutes(app);
  sessionRoutes(app);
  linkedDeviceRoutes(app);
  historyRoutes(app);

  // Conversations, messages, mutes, group photos, media and the socket (decisions 0015, 0023, 0042).
  messagingRoutes(app);

  // Other accounts, the directory and block (decisions 0022, 0024, 0036).
  accountRoutes(app, { block: blockAccount });
  friendRoutes(app, { withdraw: withdrawingRequestNotice });

  // The profile photo (decision 0039).
  photoRoutes(app);

  // Communities and membership (decision 0063).
  communityRoutes(app, communityLifecycle);
  socialRoutes(app);
  moderationRoutes(app);
  notificationRoutes(app);

  // Importing a person's posts from an export file (decision 0119).
  importRoutes(app);

  // The maintainer's jobs and restore, behind OPS_TOKEN (decision 0068).
  opsRoutes(app);

  // The frames are not a route body, so they are registered as a component
  // for the generators (decision 0005); /v1/ws points at it.
  app.openAPIRegistry.register("WsFrame", WsFrame);

  // The link host shares the Worker but not the contract.
  app.route("/", linkHost());
  app.route("/", webSignInRoutes(linkOrJoin));

  return app;
}
