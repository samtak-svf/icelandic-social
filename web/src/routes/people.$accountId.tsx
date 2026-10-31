import { createFileRoute } from "@tanstack/react-router";
import { WallScreen } from "../social/wall.tsx";
import { validateWallSearch } from "../social/wall-tabs.tsx";

// A person's screen (decision 0114) is the person's wall (decision 0115),
// signed-in only. The route has no loader, so nothing about the person reaches
// a page rendered for someone signed out; the shell shows the sign-in page
// there, with the app's own title. The web's core exports no `open_direct`
// (0034), so starting a conversation stands only in the apps.
export const Route = createFileRoute("/people/$accountId")({
  validateSearch: validateWallSearch,
  component: PersonPage,
});

function PersonPage() {
  const { accountId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WallScreen
      key={accountId}
      accountId={accountId}
      tab={tab}
      onTab={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  );
}
