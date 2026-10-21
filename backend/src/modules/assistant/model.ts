import Anthropic from "@anthropic-ai/sdk";

// The model that writes the assistant's answers (decision 0076). It is given
// a system prompt and a thread as text and gives text back; it holds no tool
// and touches nothing. Tests give the handler their own.

type Answer = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** False when the model refused or was cut off, and its text is not sent. */
  complete: boolean;
};

export type Model = (apiKey: string, system: string, thread: string) => Promise<Answer>;

const MODEL = "claude-sonnet-5-5";
/** An answer is one to four sentences; this is ample and caps a call's cost. */
const MAX_TOKENS = 600;

/** The Claude API. A failure throws, and the job is tried again later. */
export const claude: Model = async (apiKey, system, thread) => {
  // The job's own retries and backoff stand in for the client's.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: thread }],
  });
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  return {
    text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    complete: message.stop_reason === "end_turn",
  };
};
