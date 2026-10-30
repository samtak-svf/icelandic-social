import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "../chat/chat.tsx";
import { changeGroup, type GroupChange, type GroupProblem, nameOf } from "../chat/group-change.ts";
import {
  ConversationInfo,
  type GroupControls,
  type GroupDialog,
  type PhotoProblem,
} from "../chat/group-info.tsx";
import { groupPhotoProblem, noteGroupPhoto } from "../chat/group-photo.ts";
import { canChangeGroup } from "../chat/people.ts";
import { PeoplePicker } from "../chat/people-picker.tsx";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { masterOf } from "../photo.ts";

// A conversation's info (decision 0094): the picture, the title, the members
// and, for a group, the photo's controls and the four changes of 0078, the
// people picker of "add people" taking the page's place while it is open. The trailing underscore keeps it a
// page of its own rather than a child of the thread.
export const Route = createFileRoute("/conversations/$conversationId_/info")({
  component: Info,
});

function Info() {
  const { conversationId } = Route.useParams();
  const { call, subscribe, sync } = useChat();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [dialog, setDialog] = useState<GroupDialog | null>(null);
  const [picking, setPicking] = useState(false);
  const [groupProblem, setGroupProblem] = useState<GroupProblem | null>(null);
  const navigate = useNavigate();

  const reload = useCallback(() => {
    if (call === undefined) return;
    call("conversations").then(
      (all) => setConversation(all.find((c) => c.id === conversationId) ?? null),
      () => undefined,
    );
  }, [call, conversationId]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      subscribe((events) => {
        if (events.some((e) => "conversation" in e && e.conversation === conversationId)) reload();
      }),
    [subscribe, reload, conversationId],
  );

  /** Runs a change of the photo, then sends it as a send does and shows the result. */
  async function change(work: (c: NonNullable<typeof call>) => Promise<string>) {
    if (call === undefined) return;
    setBusy(true);
    setProblem(null);
    try {
      noteGroupPhoto(conversationId, await work(call));
      sync();
      reload();
    } catch (error) {
      setProblem(groupPhotoProblem(error));
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File) {
    let master: Blob | "too_large";
    try {
      master = await masterOf(file);
    } catch {
      master = "too_large";
    }
    if (master === "too_large") {
      setProblem("unsupported");
      return;
    }
    const bytes = new Uint8Array(await master.arrayBuffer());
    await change((c) => c("setGroupPhoto", conversationId, bytes));
  }

  async function remove() {
    setConfirming(false);
    await change((c) => c("clearGroupPhoto", conversationId));
  }

  /** Makes a change of the group and syncs it out as a send does; true when it was made. */
  async function alter(what: GroupChange): Promise<boolean> {
    if (call === undefined) return false;
    setBusy(true);
    setGroupProblem(null);
    const failed = await changeGroup(call, conversationId, what);
    setBusy(false);
    if (failed !== null) {
      setGroupProblem(failed);
      return false;
    }
    setDialog(null);
    sync();
    reload();
    return true;
  }

  async function confirm(name?: string | null) {
    if (dialog?.kind === "rename") {
      await alter({ kind: "rename", name: name === undefined ? nameOf(dialog.draft) : name });
    } else if (dialog?.kind === "remove") {
      await alter({ kind: "remove", account: dialog.person.account });
    } else if (dialog?.kind === "leave") {
      if (await alter({ kind: "leave" })) await navigate({ to: "/conversations" });
    }
  }

  const controls: GroupControls | null =
    conversation !== null && canChangeGroup(conversation)
      ? {
          dialog,
          problem: groupProblem,
          add: () => {
            setDialog(null);
            setGroupProblem(null);
            setPicking(true);
          },
          ask: (next) => {
            setGroupProblem(null);
            setDialog(next);
          },
          cancel: () => setDialog(null),
          confirm: (name) => void confirm(name),
        }
      : null;

  if (picking && conversation !== null && controls !== null) {
    return (
      <PeoplePicker
        taken={new Set(conversation.members.map((m) => m.account))}
        busy={busy}
        failed={groupProblem}
        add={(accounts) =>
          void alter({ kind: "add", accounts }).then((done) => done && setPicking(false))
        }
        cancel={() => {
          setGroupProblem(null);
          setPicking(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/conversations/$conversationId"
        params={{ conversationId }}
        className="inline-flex min-h-11 items-center self-start underline"
      >
        {strings.back}
      </Link>
      {conversation !== null && (
        <ConversationInfo
          conversation={conversation}
          confirming={confirming}
          busy={busy}
          problem={problem}
          pick={(file) => void pick(file)}
          askRemove={() => setConfirming(true)}
          confirmRemove={() => void remove()}
          cancelRemove={() => setConfirming(false)}
          controls={controls}
        />
      )}
    </div>
  );
}
