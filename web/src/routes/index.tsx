import { createFileRoute } from "@tanstack/react-router";

// The web shell's first page. Sign-in, Ég, settings and sessions come with
// the brand's web strings (#282) and the API client (#281).
export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <main className="min-h-dvh" />;
}
