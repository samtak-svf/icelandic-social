import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { markTester, pendingTesters, replyAsAssistant } from "./testers.ts";
import { usage } from "./usage.ts";

// The maintainer's MCP server for the testers' assistant (decision 0076),
// at /ops/mcp behind the same token as the other /ops routes. It is
// stateless: a server per request and no session, so no Durable Object
// holds it. Its tools are the /ops functions, nothing more.

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

function server(env: Env): McpServer {
  const mcp = new McpServer({ name: "spjall-ops", version: "1.0.0" });
  mcp.registerTool(
    "list_tester_requests",
    {
      description: "The tester requests waiting to be added, oldest first, with their addresses.",
      inputSchema: { platform: z.enum(["ios", "android"]).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ platform }) => json(await pendingTesters(env, platform)),
  );
  mcp.registerTool(
    "mark_tester_request",
    {
      description:
        "Marks a waiting request done or failed and clears its address; for an iPhone the assistant tells the tester.",
      inputSchema: {
        requestId: z.string().min(1).max(64),
        outcome: z.enum(["done", "failed"]),
        error: z.string().max(200).optional(),
      },
    },
    async ({ requestId, outcome, error }) =>
      json({ marked: await markTester(env, requestId, outcome, error) }),
  );
  mcp.registerTool(
    "assistant_usage",
    {
      description: "This month's model calls, tokens, cost in millionths of a dollar and refusals.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await usage(env)),
  );
  mcp.registerTool(
    "reply_as_assistant",
    {
      description: "Posts a comment as the assistant on a post in its community.",
      inputSchema: { postId: z.string().min(1).max(64), body: z.string().min(1).max(2000) },
    },
    async ({ postId, body }) => json({ posted: await replyAsAssistant(env, postId, body) }),
  );
  return mcp;
}

/** Answers one MCP request. */
export async function mcpResponse(env: Env, request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server(env).connect(transport);
  return transport.handleRequest(request);
}
