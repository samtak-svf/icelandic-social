import type { Outcome } from "../social/outcome.ts";

// Sending an export file in parts (decision 0119). A file can be 4 GiB, so a lost
// connection must not cost what has already arrived: the parts stored are kept in
// `done`, and running this again with the same set sends only the rest.

/** Parts on their way at one time. */
export const WORKERS = 3;

/** Tries at one part before the upload stops and waits for the person. */
export const ATTEMPTS = 3;

export type PartPlan = { size: number; partSize: number; parts: number };

/** Where part `part` (numbered from 1) starts and ends in the file. */
export function partBounds(plan: PartPlan, part: number): [start: number, end: number] {
  return [(part - 1) * plan.partSize, Math.min(part * plan.partSize, plan.size)];
}

/** Whether trying again can help: no answer, too many requests, or the server's own trouble. */
export function worthRetrying(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Options = {
  plan: PartPlan;
  /** The parts already stored; grows as parts arrive. */
  done: Set<number>;
  send: (part: number) => Promise<Outcome<unknown>>;
  /** Told how many parts are stored, after each one. */
  onPart: (stored: number) => void;
  pause?: (ms: number) => Promise<void>;
};

/** Sends every part not in `done`; the first answer that retrying cannot help ends it. */
export async function sendParts(options: Options): Promise<Outcome<undefined>> {
  const { plan, done, send, onPart, pause = delay } = options;
  const waiting: number[] = [];
  for (let part = 1; part <= plan.parts; part += 1) if (!done.has(part)) waiting.push(part);
  let stopped: Exclude<Outcome<unknown>, { ok: true }> | null = null;

  async function attempt(part: number): Promise<Outcome<unknown>> {
    let result = await send(part);
    for (
      let tries = 1;
      !result.ok && worthRetrying(result.status) && tries < ATTEMPTS;
      tries += 1
    ) {
      await pause(1000 * 2 ** (tries - 1));
      result = await send(part);
    }
    return result;
  }

  async function work(): Promise<void> {
    while (stopped === null) {
      const part = waiting.shift();
      if (part === undefined) return;
      const result = await attempt(part);
      if (result.ok) {
        done.add(part);
        onPart(done.size);
      } else {
        stopped ??= result;
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, work));
  return stopped ?? { ok: true, data: undefined };
}
