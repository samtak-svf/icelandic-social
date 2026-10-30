import { strings } from "./generated/brand/strings.ts";
import { formatIsDateTime } from "./lib/is-format.ts";

// What a failed call left to show (#362). A refusal the person can do nothing
// about is named, without a retry or a request id; any other is the generic
// sentence, with the server's request id when it answered.

export type Problem =
  | { kind: "unreachable" }
  | {
      kind: "refused";
      code: string | null;
      requestId: string | null;
      /** When a suspension ends, on the refusal `suspended` when it has an end. */
      until?: number;
    };

/** The codes a person is told in their own words. */
const NAMED: Record<string, string> = {
  not_permitted: strings.problem_not_permitted,
  not_found: strings.problem_not_found,
  join_declined: strings.problem_join_declined,
  pin_limit: strings.post_pin_full,
  poll_closed: strings.poll_closed_problem,
  anonymous_off: strings.problem_anonymous_off,
  suspended: strings.problem_suspended,
  request_refused: strings.problem_request_refused,
  request_limit: strings.problem_request_limit,
  friend_limit: strings.problem_friend_limit,
};

function text(data: object, field: string): string | null {
  const value: unknown = Reflect.get(data, field);
  return typeof value === "string" ? value : null;
}

/** The problem a refusal carries, read from its ApiError body when there is one. */
export function refused(data: unknown): Problem {
  if (typeof data !== "object" || data === null) {
    return { kind: "refused", code: null, requestId: null };
  }
  const until: unknown = Reflect.get(data, "until");
  return {
    kind: "refused",
    code: text(data, "error"),
    requestId: text(data, "requestId"),
    ...(typeof until === "number" ? { until } : {}),
  };
}

/** The sentence to show, and the request id to show under it, if any. */
export function describe(problem: Problem): { message: string; requestId: string | null } {
  if (problem.kind === "unreachable")
    return { message: strings.error_unreachable, requestId: null };
  if (problem.code === "suspended" && problem.until !== undefined) {
    const date = formatIsDateTime(problem.until);
    return { message: strings.problem_suspended_until({ date }), requestId: null };
  }
  const named = problem.code === null ? undefined : NAMED[problem.code];
  if (named !== undefined) return { message: named, requestId: null };
  return { message: strings.error_generic, requestId: problem.requestId };
}
