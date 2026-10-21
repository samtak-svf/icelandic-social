// The testers' assistant (decision 0076): an automated account that answers
// comments in one community with a model, and the queue of addresses testers
// give there for the maintainer's machine to add. The tester_requests,
// assistant_usage and assistant_answers tables are written only here.

import type { Handler } from "../jobs/index.ts";
import { answerHandler } from "./answer.ts";
import { claude, type Model } from "./model.ts";

export { mcpResponse } from "./mcp.ts";
export { markTester, pendingTesters, setUpAssistant } from "./testers.ts";
export { usage } from "./usage.ts";

/** The handlers of the jobs this module runs, answering with `model`. */
export const jobHandlers = (model: Model = claude): Record<string, Handler> => ({
  assistant: answerHandler(model),
});
