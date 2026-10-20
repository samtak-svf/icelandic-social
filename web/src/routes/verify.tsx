import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";

// Adding the mark (decisions 0035, 0069): Kenni vouches for the person behind
// this Google sign-in. The Worker runs the flow for this browser's session and
// comes back here with what it did; a join moves the session to the older
// account, so the account is read again.
const OUTCOMES = ["linked", "merged", "taken"] as const;
type Outcome = (typeof OUTCOMES)[number];

const isOutcome = (value: unknown): value is Outcome => OUTCOMES.some((o) => o === value);

export const Route = createFileRoute("/verify")({
  validateSearch: (search: Record<string, unknown>): { verify?: Outcome } =>
    isOutcome(search.verify) ? { verify: search.verify } : {},
  component: Verify,
});

const START = `/auth/kenni/start?next=${encodeURIComponent("/verify")}`;

function Verify() {
  const { refresh } = useAccount();
  const { verify } = Route.useSearch();

  useEffect(() => {
    if (verify === "linked" || verify === "merged") void refresh();
  }, [verify, refresh]);

  if (verify === "linked" || verify === "merged") {
    return (
      <>
        <h1 className="font-headline text-3xl">{strings.verify_title}</h1>
        <p role="status" className="mt-6">
          {verify === "linked" ? strings.verify_linked : strings.verify_merged}
        </p>
        <Link to="/" className="mt-6 inline-flex min-h-11 items-center font-medium underline">
          {strings.tab_me}
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.verify_title}</h1>
      {verify === "taken" && (
        <p role="alert" className="mt-4 font-medium">
          {strings.identity_taken}
        </p>
      )}
      <p className="mt-4">{strings.verify_body}</p>
      <ul className="mt-4 list-disc space-y-2 ps-6">
        <li>{strings.verify_point_name}</li>
        <li>{strings.verify_point_kennitala}</li>
        <li>{strings.verify_point_older}</li>
        <li>{strings.verify_point_optional}</li>
      </ul>
      {/* A full navigation: the Worker sends the browser to Kenni and back. */}
      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href={START}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-fg"
        >
          {strings.verify_action}
        </a>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface px-4 font-medium text-fg"
        >
          {strings.verify_later}
        </Link>
      </div>
    </>
  );
}
