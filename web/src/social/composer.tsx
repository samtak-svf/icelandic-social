import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import { createPost, uploadSocialMedia } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { IMAGE_TYPES, refusal } from "./images.ts";
import { outcome, type Outcome } from "./outcome.ts";

// The one text box a post and a comment are both written in; a post also
// takes up to four images (decision 0065).

export function Composer({
  label,
  action,
  max,
  send,
}: Readonly<{
  label: string;
  action: string;
  max: number;
  send: (text: string) => Promise<Outcome<unknown>>;
}>) {
  const id = useId();
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
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        maxLength={max}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-border-strong bg-surface p-2"
      />
      <Button
        tone="primary"
        type="submit"
        disabled={busy || text.trim() === ""}
        className="self-end"
      >
        {action}
      </Button>
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
export function PostComposer({
  communityId,
  posted,
}: Readonly<{ communityId: string; posted: () => void }>) {
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
      <label htmlFor={id} className="font-semibold">
        {strings.post_compose}
      </label>
      <textarea
        id={id}
        value={text}
        maxLength={5000}
        rows={3}
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
