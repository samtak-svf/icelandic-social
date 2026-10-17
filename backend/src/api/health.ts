import { createRoute, z } from "@hono/zod-openapi";
import { CLIENTS } from "../platforms.ts";
import { PUBLIC } from "./common.ts";

const Version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .openapi({ example: "1.4.0" });

/** One version per platform, keyed by its name. */
export const versionPerPlatform = <P extends string>(platforms: readonly P[]) =>
  z.object(Object.fromEntries(platforms.map((p) => [p, Version])) as Record<P, typeof Version>);

export const Health = z
  .object({
    status: z.literal("ok"),
    minClientVersion: versionPerPlatform(CLIENTS).openapi({
      description:
        "The oldest build each client may run. An older app asks the user to update; an older web tab reloads, since `web` is the build the Worker serves.",
    }),
  })
  .openapi("Health");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  security: PUBLIC,
  tags: ["meta"],
  summary: "Liveness and the minimum client version per platform",
  responses: {
    200: {
      description: "The Worker is up",
      content: { "application/json": { schema: Health } },
    },
  },
});
