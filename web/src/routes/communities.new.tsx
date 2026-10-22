import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";
import { CreateCommunity } from "../social/create-community.tsx";
import { Status } from "../ui/kit.tsx";
import { VerifyCta } from "../ui/verify.tsx";

// Stofna samfélag (decisions 0063, 0080): its own screen, opened from the
// first row of the hub, so the hub itself holds only the list and the feed.
export const Route = createFileRoute("/communities/new")({ component: NewCommunity });

function NewCommunity() {
  const { state } = useAccount();
  return (
    <>
      <Link to="/communities" className="inline-flex min-h-11 items-center underline">
        {strings.back}
      </Link>
      <h1 className="font-headline text-3xl">{strings.community_create}</h1>
      {state.status !== "signed-in" ? (
        <Status>{strings.loading}</Status>
      ) : state.me.verified ? (
        <CreateCommunity />
      ) : (
        <VerifyCta />
      )}
    </>
  );
}
