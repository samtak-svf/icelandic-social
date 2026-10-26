import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { PicturePick } from "../social/picture-pick.tsx";
import { Button, Status } from "../ui/kit.tsx";
import { ConversationAvatar } from "./conversation-avatar.tsx";
import { conversationTitle, isGroup, shownName } from "./people.ts";

/** What went wrong with the last change of the photo; "unsupported" has no retry. */
export type PhotoProblem = "unsupported" | "failed";

/**
 * The conversation's info page (decision 0094): the 96 px picture, the title
 * and the members; for a group also the photo's controls. Renaming is the
 * apps' (0078), not here. State and calls belong to the route, so this draws
 * from its props alone.
 */
export function ConversationInfo({
  conversation,
  confirming,
  busy,
  problem,
  pick,
  askRemove,
  confirmRemove,
  cancelRemove,
}: Readonly<{
  conversation: Conversation;
  /** Whether the removal is waiting for its confirmation. */
  confirming: boolean;
  busy: boolean;
  problem: PhotoProblem | null;
  pick: (file: File) => void;
  askRemove: () => void;
  confirmRemove: () => void;
  cancelRemove: () => void;
}>) {
  const group = isGroup(conversation);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <ConversationAvatar conversation={conversation} className="size-24 rounded-full text-4xl" />
        <h1 className="min-w-0 break-words font-headline text-2xl">
          {conversationTitle(conversation)}
        </h1>
      </div>
      {group && (
        <section className="flex flex-col gap-3">
          <PicturePick
            label={
              conversation.photo === null ? strings.group_photo_choose : strings.group_photo_change
            }
            removeLabel={strings.group_photo_remove}
            chosen={null}
            disabled={busy}
            pick={pick}
            remove={conversation.photo === null || confirming ? null : askRemove}
          />
          {confirming && (
            <div
              role="alertdialog"
              aria-label={strings.group_photo_remove}
              className="flex flex-col gap-2"
            >
              <p>{strings.group_photo_remove_confirm}</p>
              <div className="flex gap-2">
                <Button tone="primary" disabled={busy} onClick={confirmRemove}>
                  {strings.group_photo_remove}
                </Button>
                <Button disabled={busy} onClick={cancelRemove}>
                  {strings.cancel}
                </Button>
              </div>
            </div>
          )}
          <Status>
            {problem === "unsupported" && strings.group_photo_unsupported}
            {problem === "failed" && strings.group_photo_failed}
          </Status>
          <p className="text-sm text-muted-fg">{strings.group_photo_seen_by_members}</p>
        </section>
      )}
      <section aria-label={strings.group_member_count({ count: conversation.members.length })}>
        <h2 className="text-sm text-muted-fg">
          {strings.group_member_count({ count: conversation.members.length })}
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {conversation.members.map((m) => (
            <li key={m.account} className="min-h-8">
              {shownName(m)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
