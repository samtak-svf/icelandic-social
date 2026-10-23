import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import { createPost, uploadSocialMedia } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { Avatar } from "./avatar.tsx";
import { IMAGE_TYPES, refusal } from "./images.ts";
import { outcome, type Outcome } from "./outcome.ts";

// The one text box a post and a comment are both written in; a post also
// takes up to four images (decision 0065).

/**
 * The comment box as one row (decision 0080): the writer's own picture, a
 * pill that grows to five lines as they write, and a send button. Enter
 * starts a new line; the button sends.
 */
export function CommentComposer({
  label,
  placeholder,
  action,
  max,
  send,
}: Readonly<{
  label: string;
  placeholder: string;
  action: string;
  max: number;
  send: (text: string) => Promise<Outcome<unknown>>;
}>) {
  const id = useId();
  const { state } = useAccount();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const sent = await send(text.trim());
    setBusy(false);
    if (sent.ok) setText("");
    else setProblem(sent.problem);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        {state.status === "signed-in" && (
          <Avatar
            kind="person"
            id={state.me.accountId}
            name={state.me.name}
            photo={state.me.photo}
            className="size-10 shrink-0 rounded-full"
          />
        )}
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <textarea
          id={id}
          value={text}
          maxLength={max}
          rows={1}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          className="field-sizing-content max-h-[7.5rem] min-h-11 min-w-0 flex-1 resize-none rounded-3xl bg-muted px-4 py-2.5 leading-6"
        />
        <button
          type="submit"
          aria-label={action}
          disabled={busy || text.trim() === ""}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-muted disabled:opacity-40"
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
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4z" />
          </svg>
        </button>
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </form>
  );
}

const REFUSED = {
  too_many: strings.post_images_too_many,
  too_large: strings.post_image_too_large,
  invalid_image: strings.post_image_failed,
} as const;

/**
 * A new post: its text, its images, or both. The images are checked when
 * chosen and uploaded when the post is published, then named in it.
 */
function PostForm({ communityId, posted }: Readonly<{ communityId: string; posted: () => void }>) {
  const id = useId();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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
      const stored = await outcome(uploadSocialMedia({ path, body: file }), 200);
      if (stored.ok) media.push(stored.data.mediaId);
      else if (stored.status === 400) return "invalid_image";
      else if (stored.status === 413) return "too_large";
      else return stored.problem;
    }
    const sent = await outcome(createPost({ path, body: { body: text.trim(), media } }), 200);
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
            disabled={busy}
            onChange={choose}
          />
        </label>
        <Button
          tone="primary"
          type="submit"
          disabled={busy || (text.trim() === "" && files.length === 0)}
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
  communityId,
  posted,
}: Readonly<{ communityId: string; posted: () => void }>) {
  const { state } = useAccount();
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
          onClick={() => setOpen(true)}
          className="flex min-h-11 flex-1 items-center rounded-full bg-muted px-4 text-left text-muted-fg"
        >
          {strings.post_compose_prompt}
        </button>
        <button
          type="button"
          aria-label={strings.post_add_images}
          onClick={() => setOpen(true)}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted"
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
