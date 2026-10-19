import { Link } from "@tanstack/react-router";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";

/** On Ég and in settings, for an account Kenni has not verified: the way to the mark (0069). */
export function VerifyCta() {
  const { state } = useAccount();
  if (state.status !== "signed-in" || state.me.verified) return null;
  return (
    <Link
      to="/verify"
      className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface px-4 font-medium text-fg"
    >
      {strings.verify_cta}
    </Link>
  );
}
