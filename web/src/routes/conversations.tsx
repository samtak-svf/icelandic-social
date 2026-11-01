import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { useChat } from "../chat/chat.tsx";
import { ConversationList } from "../chat/conversation-list.tsx";
import { LinkPage } from "../chat/link-page.tsx";
import { strings } from "../generated/brand/strings.ts";
import { Button, Status } from "../ui/kit.tsx";
import { LAYOUTS } from "../ui/layout.ts";
import { useSizeClass } from "../ui/size-class.ts";

// The conversations (decisions 0064, 0081). The chat itself is around every
// signed-in page (0124); the tab showing these pages takes it from a tab that
// only counts. On an expanded window the list stays beside the open
// conversation (0093).
export const Route = createFileRoute("/conversations")({
  component: Gate,
  staticData: { width: "wide", noSuspendedNotice: true },
});

/** The list and the open conversation side by side, or the one page shown. */
function Panes() {
  const twoPanes = LAYOUTS[useSizeClass()].conversations === "list-and-thread";
  const open = useMatches({
    select: (ms) => ms.some((m) => m.routeId === "/conversations/$conversationId"),
  });
  if (!twoPanes) return <Outlet />;
  return (
    <div className="grid grid-cols-[22rem_minmax(0,1fr)] items-start gap-8">
      <section
        aria-label={strings.tab_conversations}
        className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto"
      >
        <ConversationList level={open ? 2 : 1} />
      </section>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

function Gate() {
  const { state, useHere, restart } = useChat();
  switch (state) {
    case "ready":
      return <Panes />;
    case "elsewhere":
      return (
        <>
          <p role="status">{strings.chat_other_tab}</p>
          <Button tone="primary" className="mt-4" onClick={useHere}>
            {strings.chat_use_here}
          </Button>
        </>
      );
    case "lost":
      return (
        <>
          <p role="alert">{strings.chat_device_lost}</p>
          <Button tone="primary" className="mt-4" onClick={restart}>
            {strings.device_link_web_title}
          </Button>
        </>
      );
    case "unlinked":
      return <LinkPage />;
    case "failed":
      return (
        <Button tone="primary" onClick={() => location.reload()}>
          {strings.try_again}
        </Button>
      );
    default:
      return <Status>{strings.loading}</Status>;
  }
}
