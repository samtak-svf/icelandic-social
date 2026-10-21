import { db } from "../../env/index.ts";

// What the assistant's model costs, per calendar month in UTC (decision
// 0076), in millionths of a dollar. The price is the model's list price per
// token; checked before every call, so a month stops at its cap.

/** Millionths of a dollar per input and per output token. */
const PRICE = { input: 2, output: 10 } as const;

export type Usage = {
  month: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  refused: number;
};

/** The month of `at`, as YYYY-MM in UTC. */
const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7);

/** This month's usage, zeros before its first call. */
export async function usage(env: Env, at = Date.now()): Promise<Usage> {
  const month = monthOf(at);
  const row = await db(env)
    .prepare(
      `SELECT month, calls, input_tokens AS inputTokens, output_tokens AS outputTokens,
              cost_micro_usd AS costMicroUsd, refused
         FROM assistant_usage WHERE month = ?`,
    )
    .bind(month)
    .first<Usage>();
  return row ?? { month, calls: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, refused: 0 };
}

/** Counts one call of `input` and `output` tokens; what it cost. */
export async function recordCall(env: Env, input: number, output: number): Promise<number> {
  const cost = input * PRICE.input + output * PRICE.output;
  await db(env)
    .prepare(
      `INSERT INTO assistant_usage (month, calls, input_tokens, output_tokens, cost_micro_usd)
       VALUES (?1, 1, ?2, ?3, ?4)
       ON CONFLICT (month) DO UPDATE SET calls = calls + 1,
         input_tokens = input_tokens + ?2, output_tokens = output_tokens + ?3,
         cost_micro_usd = cost_micro_usd + ?4`,
    )
    .bind(monthOf(Date.now()), input, output, cost)
    .run();
  return cost;
}

/** Counts a call not made because the month had reached its cap. */
export async function recordRefusal(env: Env): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO assistant_usage (month, refused) VALUES (?, 1)
       ON CONFLICT (month) DO UPDATE SET refused = refused + 1`,
    )
    .bind(monthOf(Date.now()))
    .run();
}
