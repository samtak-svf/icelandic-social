import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Problem } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";

// The few pieces every page is built from. Colours are brand tokens
// (generated/brand/theme.css), whose pairs check:brand holds to WCAG.

const BUTTON = {
  primary: "bg-primary text-primary-fg",
  quiet: "border border-border-strong bg-surface text-fg",
  danger: "border border-danger bg-surface text-danger",
} as const;

export function Button({
  tone = "quiet",
  className = "",
  ...rest
}: Readonly<ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BUTTON }>) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-md px-4 font-medium disabled:opacity-60 ${BUTTON[tone]} ${className}`}
      {...rest}
    />
  );
}

/** What went wrong, read out as it appears; with the request id when the server gave one. */
export function ProblemText({ problem }: Readonly<{ problem: Problem }>) {
  return (
    <span>
      {problem.kind === "unreachable" ? strings.error_unreachable : strings.error_generic}
      {problem.kind === "refused" && problem.requestId !== null && (
        <span className="block text-sm text-muted-fg">
          {strings.problem_request_id({ id: problem.requestId })}
        </span>
      )}
    </span>
  );
}

/** A polite live region: what it holds is announced when it changes. */
export function Status({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <p role="status" className="min-h-6 text-sm">
      {children}
    </p>
  );
}
