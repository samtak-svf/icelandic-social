import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Person } from "../generated/core.d.ts";
import { PicturePick } from "../social/picture-pick.tsx";
import { Button, Status } from "../ui/kit.tsx";
import { ConversationAvatar } from "./conversation-avatar.tsx";
import { type GroupProblem, NAME_LIMIT } from "./group-change.ts";
import { conversationTitle, isGroup, shownName } from "./people.ts";
import { clipText } from "../lib/char-count.ts";

/** What went wrong with the last change of the photo; "unsupported" has no retry. */
export type PhotoProblem = "unsupported" | "failed";

/** What a group's change is waiting on before it is made (0078). */
export type GroupDialog =
  | { kind: "rename"; draft: string }
  | { kind: "remove"; person: Person }
  | { kind: "leave" };

/** A member's controls over the group (0078); none once the group is left or the member removed. */
export interface GroupControls {
  dialog: GroupDialog | null;
  problem: GroupProblem | null;
  /** Opens the people picker. */
  add: () => void;
  /** Opens a dialog, or replaces it with one holding more of the name being typed. */
  ask: (dialog: GroupDialog) => void;
  cancel: () => void;
  /** Makes the change the open dialog asks for; `null` clears the name at once. */
  confirm: (name?: string | null) => void;
}

/**
 * The conversation's info page (decision 0094): the 96 px picture, the title
 * and the members; for a group also the photo's controls and, for a member
 * who can still change it, the four changes of 0078: add people, remove a
 * member, name the group and leave it. State and calls belong to the route,
 * so this draws from its props alone.
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
  controls,
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
  /** Null when the member cannot change the group: a left group reads as read-only. */
  controls: GroupControls | null;
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
      {group && controls !== null && (
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
      {group && controls !== null && (
        <GroupActions conversation={conversation} controls={controls} busy={busy} />
      )}
      <section aria-label={strings.group_member_count({ count: conversation.members.length })}>
        <h2 className="text-sm text-muted-fg">
          {strings.group_member_count({ count: conversation.members.length })}
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {conversation.members.map((m) => (
            <li key={m.account} className="flex min-h-11 items-center justify-between gap-2">
              <span className="min-w-0 break-words">{shownName(m)}</span>
              {group && controls !== null && (
                <Button
                  tone="link"
                  disabled={busy}
                  onClick={() => controls.ask({ kind: "remove", person: m })}
                >
                  {strings.remove_member}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {group && controls !== null && (
        <section className="flex flex-col gap-2">
          <Button tone="danger" disabled={busy} onClick={() => controls.ask({ kind: "leave" })}>
            {strings.leave_group}
          </Button>
        </section>
      )}
    </div>
  );
}

/** Add people and name the group, with the question each change waits on and what went wrong. */
function GroupActions({
  conversation,
  controls,
  busy,
}: Readonly<{ conversation: Conversation; controls: GroupControls; busy: boolean }>) {
  const { dialog, problem } = controls;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={controls.add}>
          {strings.add_people}
        </Button>
        <Button
          disabled={busy}
          onClick={() => controls.ask({ kind: "rename", draft: conversation.name ?? "" })}
        >
          {strings.group_name}
        </Button>
      </div>
      {dialog?.kind === "rename" && (
        <form
          aria-label={strings.group_name_title}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            controls.confirm();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-fg">{strings.group_name_title}</span>
            <input
              value={dialog.draft}
              placeholder={strings.group_name_hint}
              onChange={(e) =>
                controls.ask({ kind: "rename", draft: clipText(e.target.value, NAME_LIMIT) })
              }
              className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" type="submit" disabled={busy}>
              {strings.save}
            </Button>
            {conversation.name !== null && (
              <Button tone="danger" disabled={busy} onClick={() => controls.confirm(null)}>
                {strings.group_name_remove}
              </Button>
            )}
            <Button disabled={busy} onClick={controls.cancel}>
              {strings.cancel}
            </Button>
          </div>
        </form>
      )}
      {dialog?.kind === "remove" && (
        <Confirm
          question={strings.remove_member_confirm({ name: shownName(dialog.person) })}
          label={strings.remove_member}
          busy={busy}
          controls={controls}
        />
      )}
      {dialog?.kind === "leave" && (
        <Confirm
          question={strings.leave_group_confirm}
          label={strings.leave_group}
          busy={busy}
          controls={controls}
        />
      )}
      <Status>
        {problem === "unreachable" && strings.error_unreachable}
        {problem === "failed" && strings.error_generic}
      </Status>
    </section>
  );
}

/** A destructive change asks first, as the apps' dialogs do (0078). */
function Confirm({
  question,
  label,
  busy,
  controls,
}: Readonly<{ question: string; label: string; busy: boolean; controls: GroupControls }>) {
  return (
    <div role="alertdialog" aria-label={label} className="flex flex-col gap-2">
      <p>{question}</p>
      <div className="flex gap-2">
        <Button tone="danger" disabled={busy} onClick={() => controls.confirm()}>
          {label}
        </Button>
        <Button disabled={busy} onClick={controls.cancel}>
          {strings.cancel}
        </Button>
      </div>
    </div>
  );
}
