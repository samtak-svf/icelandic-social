import { createFileRoute } from "@tanstack/react-router";
import { ConversationList } from "../chat/conversation-list.tsx";
import { strings } from "../generated/brand/strings.ts";
import { LAYOUTS } from "../ui/layout.ts";
import { useSizeClass } from "../ui/size-class.ts";

// The list on its own; beside it on an expanded window (decision 0093) the
// list is the layout's, and this pane asks for a conversation to open.
export const Route = createFileRoute("/conversations/")({ component: Index });

function Index() {
  if (LAYOUTS[useSizeClass()].conversations === "list") return <ConversationList level={1} />;
  return <p className="pt-12 text-center text-muted-fg">{strings.conversations_pick}</p>;
}
