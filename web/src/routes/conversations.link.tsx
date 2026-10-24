import { createFileRoute, Navigate } from "@tanstack/react-router";

// The link page itself is shown by the layout while nothing is linked here;
// this address is only reached once the chat is running, so it goes on to the list.
export const Route = createFileRoute("/conversations/link")({
  component: () => <Navigate to="/conversations" replace />,
});
