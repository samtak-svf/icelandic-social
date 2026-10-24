import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAccount } from "../account.tsx";
import { ChatProvider, useChat } from "../chat/chat.tsx";
import { LinkPage } from "../chat/link-page.tsx";
import { strings } from "../generated/brand/strings.ts";
import { Button, Status } from "../ui/kit.tsx";

// The conversations (decisions 0064, 0081). The chat is mounted here and
// nowhere else: only the tab showing these pages competes for the store.
export const Route = createFileRoute("/conversations")({ component: Conversations });

function Conversations() {
  return (
    <ChatProvider>
      <Gate />
    </ChatProvider>
  );
}

function Gate() {
  const { state, useHere, restart } = useChat();
  const { signedOut } = useAccount();
  useEffect(() => {
    if (state === "signed-out") signedOut();
  }, [state, signedOut]);
  switch (state) {
    case "ready":
      return <Outlet />;
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
