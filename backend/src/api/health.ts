import { createRoute, z } from "@hono/zod-openapi";

const Version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .openapi({ example: "1.4.0" });

export const Health = z
  .object({
    status: z.literal("ok"),
    minClientVersion: z.object({ android: Version, ios: Version }).openapi({
      description: "The oldest build each platform may run. An older app asks the user to update.",
    }),
  })
  .openapi("Health");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  tags: ["meta"],
  summary: "Liveness and the minimum client version per platform",
  responses: {
    200: {
      description: "The Worker is up",
      content: { "application/json": { schema: Health } },
    },
  },
});
