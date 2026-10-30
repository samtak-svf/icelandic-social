import { createFileRoute } from "@tanstack/react-router";
import { PlatformModeration } from "../social/platform-moderation.tsx";

// Samtak's moderation page (decision 0115): the platform's report queue and
// log for its moderators. Settings links here for an account `Me` says is one.
// The server refuses anyone else, and the page shows the refusal.
export const Route = createFileRoute("/moderation")({
  component: PlatformModeration,
  staticData: { width: "wide" },
});
