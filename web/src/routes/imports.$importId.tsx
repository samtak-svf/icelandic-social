import { createFileRoute } from "@tanstack/react-router";
import { ImportPreview } from "../imports/preview.tsx";

// One import: what was read, and the choice of what to publish (decisions 0119, 0120).
export const Route = createFileRoute("/imports/$importId")({ component: ImportPage });

function ImportPage() {
  const { importId } = Route.useParams();
  return <ImportPreview key={importId} importId={importId} />;
}
