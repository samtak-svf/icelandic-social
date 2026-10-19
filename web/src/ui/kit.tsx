import type { ButtonHTMLAttributes, ReactNode } from "react";
import { describe, type Problem } from "../problem.ts";
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

/** What went wrong, read out as it appears; with the request id when it helps (#362). */
export function ProblemText({ problem }: Readonly<{ problem: Problem }>) {
  const { message, requestId } = describe(problem);
  return (
    <span>
      {message}
      {requestId !== null && (
        <span className="block text-sm text-muted-fg">
          {strings.problem_request_id({ id: requestId })}
        </span>
      )}
    </span>
  );
}

/** The mark Kenni gives a verified account, with its word so it is read out too (#358). */
export function VerifiedMark({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <span className={`inline-flex items-center gap-1 font-medium text-verified-mark ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[1em] fill-current">
        <path d="M8 0l2 2.3 3-.3.3 3L16 8l-2.7 3 .3 3-3-.3L8 16l-2-2.3-3 .3-.3-3L0 8l2.3-2-.3-3 3 .3z" />
      </svg>
      {strings.verified_short}
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
