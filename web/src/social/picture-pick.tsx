import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import type { Problem } from "../problem.ts";
import {
  removeCommunityAvatar,
  removeCommunityCover,
  setCommunityAvatar,
  setCommunityCover,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { squarePhoto } from "../photo.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { Avatar, Cover } from "./avatar.tsx";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./images.ts";
import { outcome } from "./outcome.ts";

// The picture and the cover of a community (decision 0080), chosen on the
// create screen and changed in Stjórna → Breyta samfélagi. A choice past the
// size the server takes is refused here, before any upload.

/** A `<label>`-wrapped file input that reads as a button, and, when set, the way to take it away. */
export function PicturePick({
  label,
  removeLabel,
  chosen,
  disabled,
  pick,
  remove,
  preview,
}: Readonly<{
  label: string;
  removeLabel: string;
  /** The name of the file chosen but not yet sent, or null. */
  chosen: string | null;
  disabled: boolean;
  pick: (file: File) => void;
  /** Absent when there is nothing to take away. */
  remove: (() => void) | null;
  preview?: ReactNode;
}>) {
  const id = useId();
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) pick(file);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {preview}
      <label
        htmlFor={id}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong bg-surface px-4 font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
      >
        {label}
        <input
          id={id}
          type="file"
          accept={IMAGE_TYPES}
          className="sr-only"
          disabled={disabled}
          onChange={choose}
        />
      </label>
      {chosen !== null && <span className="min-w-0 truncate text-sm">{chosen}</span>}
      {remove !== null && (
        <Button disabled={disabled} onClick={remove}>
          {removeLabel}
        </Button>
      )}
    </div>
  );
}

/** Why `file` may not be sent as a picture, or null. */
export function tooLarge(file: { size: number }): boolean {
  return file.size > MAX_IMAGE_BYTES;
}

/** Sends a community's picture or cover; the problem, or null when it went. */
export async function sendImage(
  communityId: string,
  which: "picture" | "cover",
  file: File,
): Promise<Problem | "too_large" | "invalid_image" | null> {
  if (tooLarge(file)) return "too_large";
  const path = { communityId };
  let sent;
  if (which === "picture") {
    let body: Blob;
    try {
      body = await squarePhoto(file);
    } catch {
      return "invalid_image";
    }
    sent = await outcome(setCommunityAvatar({ path, body }), 200);
  } else {
    sent = await outcome(setCommunityCover({ path, body: file }), 200);
  }
  if (sent.ok) return null;
  if (sent.status === 400) return "invalid_image";
  if (sent.status === 413) return "too_large";
  return sent.problem;
}

const REFUSED = {
  too_large: strings.post_image_too_large,
  invalid_image: strings.post_image_failed,
} as const;

/** What went wrong with an image, as a sentence. */
export function ImageProblem({
  problem,
}: Readonly<{ problem: Problem | keyof typeof REFUSED | null }>) {
  return (
    <Status>
      {typeof problem === "string"
        ? REFUSED[problem]
        : problem !== null && <ProblemText problem={problem} />}
    </Status>
  );
}

/** Breyta samfélagi's pictures: each is sent when chosen and removed on request. */
export function CommunityPictures({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const { communityId } = community;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | keyof typeof REFUSED | null>(null);

  async function run(work: () => Promise<Problem | keyof typeof REFUSED | null>) {
    setBusy(true);
    setProblem(null);
    const failed = await work();
    setBusy(false);
    setProblem(failed);
    if (failed === null) changed();
  }
  const removal =
    (
      pending: () =>
        | ReturnType<typeof removeCommunityAvatar>
        | ReturnType<typeof removeCommunityCover>,
    ) =>
    async () => {
      const done = await outcome(pending(), 204);
      return done.ok ? null : done.problem;
    };

  return (
    <div className="flex flex-col gap-3">
      <PicturePick
        label={strings.community_picture_choose}
        removeLabel={strings.community_picture_remove}
        chosen={null}
        disabled={busy}
        pick={(file) => void run(() => sendImage(communityId, "picture", file))}
        remove={
          community.photo === null
            ? null
            : () => void run(removal(() => removeCommunityAvatar({ path: { communityId } })))
        }
        preview={
          <Avatar
            kind="community"
            id={communityId}
            name={community.name}
            photo={community.photo}
            className="size-14 rounded-lg text-xl"
          />
        }
      />
      <Cover communityId={communityId} version={community.cover} className="rounded-md" />
      <PicturePick
        label={strings.community_cover_choose}
        removeLabel={strings.community_cover_remove}
        chosen={null}
        disabled={busy}
        pick={(file) => void run(() => sendImage(communityId, "cover", file))}
        remove={
          community.cover === null
            ? null
            : () => void run(removal(() => removeCommunityCover({ path: { communityId } })))
        }
      />
      <ImageProblem problem={problem} />
    </div>
  );
}
