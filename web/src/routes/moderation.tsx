import { createFileRoute } from "@tanstack/react-router";
import { PlatformModeration } from "../social/platform-moderation.tsx";

// Samtak's moderation page (decision 0115): the platform's report queue and
// log for its moderators. No link leads here yet: the contract does not tell
// a client who is one, and the page does not ask on another page to find out.
// The server refuses anyone else, and the page shows the refusal.
export const Route = createFileRoute("/moderation")({
  component: PlatformModeration,
  staticData: { width: "wide" },
});
