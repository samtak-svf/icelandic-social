import { createFileRoute } from "@tanstack/react-router";
import { validateImportsSearch } from "../imports/page-section.tsx";
import { ImportsScreen } from "../imports/screen.tsx";

// Bringing a person's own posts in from another platform (decisions 0119, 0120).
export const Route = createFileRoute("/imports/")({
  validateSearch: validateImportsSearch,
  component: ImportsPage,
});

function ImportsPage() {
  const { page } = Route.useSearch();
  return <ImportsScreen notice={page} />;
}
