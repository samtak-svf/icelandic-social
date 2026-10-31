import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  createPost,
  createWallPost,
  uploadSocialMedia,
  uploadWallMedia,
  type WallAudience,
} from "../generated/api.ts";
import { WallAudienceFields } from "./audience.tsx";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { Avatar } from "./avatar.tsx";
import { IMAGE_TYPES, refusal } from "./images.ts";
import { outcome } from "./outcome.ts";
import { canPublishPoll, emptyPoll, pollOptions } from "./poll-draft.ts";
import { PollFields } from "./poll-fields.tsx";
import { useSuspended } from "./suspended.tsx";

// The one text box a post and a comment are both written in; a post also
// takes up to four images (decision 0065).

export const REFUSED = {
  too_many: strings.post_images_too_many,
  too_large: strings.post_image_too_large,
  invalid_image: strings.post_image_failed,
} as const;

/**
 * A new post: its text, its images, or both. The images are checked when
 * chosen and uploaded when the post is published, then named in it.
 */
function PostForm({
  communityId,
  posted,
  anonymousAllowed,
  wall,
}: Readonly<{
  communityId: string;
  posted: () => void;
  anonymousAllowed: boolean;
  /** Writing on one's own wall (decision 0115): an audience, and no community. */
  wall: boolean;
}>) {
  const id = useId();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [audience, setAudience] = useState<WallAudience>("friends");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | keyof typeof REFUSED | null>(null);
  const path = { communityId };

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    const refused = refusal(files.length, picked);
    setProblem(refused);
    if (refused === null) setFiles([...files, ...picked]);
  }

  async function publish(): Promise<Problem | keyof typeof REFUSED | null> {
    const media: string[] = [];
    for (const file of files) {
      const stored = await outcome(
        wall ? uploadWallMedia({ body: file }) : uploadSocialMedia({ path, body: file }),
        200,
      );
      if (stored.ok) media.push(stored.data.mediaId);
      else if (stored.status === 400) return "invalid_image";
      else if (stored.status === 413) return "too_large";
      else return stored.problem;
    }
    const content = {
      body: text.trim(),
      media,
      ...(poll === null ? {} : { poll: { options: pollOptions(poll) } }),
    };
    const sent = await outcome(
      wall
        ? createWallPost({ body: { ...content, audience } })
        : createPost({
            path,
            body: { ...content, ...(anonymousAllowed && anonymous ? { anonymous: true } : {}) },
          }),
      200,
    );
    return sent.ok ? null : sent.problem;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const failed = await publish();
    setBusy(false);
    setProblem(failed);
    if (failed === null) {
      setText("");
      setFiles([]);
      setPoll(null);
      setAnonymous(false);
      posted();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {strings.post_compose}
      </label>
      <textarea
        id={id}
        value={text}
        maxLength={5000}
        rows={4}
        placeholder={strings.post_compose_prompt}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog was opened to write in it
        autoFocus
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-border-strong bg-surface p-2"
      />
      {poll !== null && <PollFields options={poll} busy={busy} change={setPoll} />}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, at) => (
            <li
              key={`${at}-${file.name}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate">{file.name}</span>
              <Button
                className="text-sm"
                disabled={busy}
                onClick={() => setFiles(files.filter((_, i) => i !== at))}
              >
                {strings.post_image_remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {wall && <WallAudienceFields value={audience} onChange={setAudience} disabled={busy} />}
      {anonymousAllowed && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={anonymous}
            disabled={busy}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          <span className="flex flex-col">
            <span className="font-semibold">{strings.composer_anonymous}</span>
            <span className="text-sm text-muted-fg">{strings.composer_anonymous_hint}</span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`${id}-images`}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong bg-surface px-4 font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
        >
          {strings.post_add_images}
          <input
            id={`${id}-images`}
            type="file"
            accept={IMAGE_TYPES}
            multiple
            className="sr-only"
            disabled={busy || poll !== null}
            onChange={choose}
          />
        </label>
        <Button
          aria-pressed={poll !== null}
          disabled={busy || files.length > 0}
          onClick={() => setPoll(poll === null ? emptyPoll() : null)}
        >
          {strings.composer_poll}
        </Button>
        <Button
          tone="primary"
          type="submit"
          disabled={
            busy ||
            (poll === null ? text.trim() === "" && files.length === 0 : !canPublishPoll(text, poll))
          }
        >
          {strings.post_publish}
        </Button>
      </div>
      <Status>
        {busy
          ? strings.loading
          : typeof problem === "string"
            ? REFUSED[problem]
            : problem !== null && <ProblemText problem={problem} />}
      </Status>
    </form>
  );
}

/**
 * The composer as one row (decision 0080): the writer's own picture, a pill
 * that says what to write, and a photo button. Either opens the dialog that
 * holds the whole form, so the card list keeps its place.
 */
export function PostComposer({
  communityId = "",
  posted,
  anonymousAllowed = false,
  wall = false,
}: Readonly<{
  communityId?: string;
  posted: () => void;
  anonymousAllowed?: boolean;
  wall?: boolean;
}>) {
  const { state } = useAccount();
  const suspended = useSuspended();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        {state.status === "signed-in" && (
          <Avatar
            kind="person"
            id={state.me.accountId}
            name={state.me.name}
            photo={state.me.photo}
            className="size-10 rounded-full"
          />
        )}
        <button
          type="button"
          disabled={suspended}
          onClick={() => setOpen(true)}
          className="flex min-h-11 flex-1 items-center rounded-full bg-muted px-4 text-left text-muted-fg disabled:opacity-60"
        >
          {strings.post_compose_prompt}
        </button>
        <button
          type="button"
          aria-label={strings.post_add_images}
          disabled={suspended}
          onClick={() => setOpen(true)}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-60"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path d="m21 16-5-5-9 9" />
          </svg>
        </button>
      </div>
      {open && (
        <Dialog title={strings.post_compose} onClose={() => setOpen(false)}>
          <PostForm
            communityId={communityId}
            anonymousAllowed={anonymousAllowed}
            wall={wall}
            posted={() => {
              setOpen(false);
              posted();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
