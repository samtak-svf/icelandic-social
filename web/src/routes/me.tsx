import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";
import { WallScreen } from "../social/wall.tsx";
import { validateWallSearch } from "../social/wall-tabs.tsx";
import { Status } from "../ui/kit.tsx";

// Ég (decisions 0034, 0039, 0115, 0116: moved from / to /me when the feed took the first place): one's own wall. The name comes from Google
// or from Kenni and is never typed (decision 0043); the photo, the cover and
// the bio are the owner's to change, from the wall itself. Settings stay
// reachable from the shell.
export const Route = createFileRoute("/me")({
  validateSearch: validateWallSearch,
  component: MePage,
});

function MePage() {
  const { state } = useAccount();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (state.status !== "signed-in") {
    return (
      <>
        <h1 className="sr-only">{strings.tab_me}</h1>
        <Status>{strings.loading}</Status>
      </>
    );
  }
  return (
    <WallScreen
      accountId={state.me.accountId}
      tab={tab}
      onTab={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  );
}
