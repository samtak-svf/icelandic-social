import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { removeCommunityAvatar, removeCommunityCover, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button } from "../ui/kit.tsx";
import type { Framing } from "../generated/frames.ts";
import { Avatar, Cover } from "./avatar.tsx";
import { useFrameSession } from "./frame-session.tsx";
import { putFramed, type SendProblem, type Target } from "./frame-send.ts";
import { ImageProblem } from "./image-problem.tsx";
import { IMAGE_TYPES } from "./images.ts";
import { outcome } from "./outcome.ts";

// The picture and the cover of a community (decision 0080), chosen on the
// create screen and changed in Stjórna → `community_edit`. A choice past the
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

/** Sends a community's picture or cover, framed; the problem, or null when it went. */
export function sendImage(
  communityId: string,
  which: "picture" | "cover",
  chosen: Readonly<{ master: Blob; framing: Framing | null }>,
): Promise<SendProblem | null> {
  return putFramed({ kind: which, communityId }, chosen.master, chosen.framing);
}

/** `community_edit`'s pictures: each is framed and sent when chosen, framed again on request, and removed on request. */
export function CommunityPictures({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const { communityId } = community;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const { sheet, choose, reframe } = useFrameSession();

  async function run(work: () => Promise<SendProblem | null>) {
    setBusy(true);
    setProblem(null);
    const failed = await work();
    setBusy(false);
    setProblem(failed);
    if (failed === null) changed();
  }
  /** Opens the sheet; saving there is what sends, so nothing is busy here. */
  async function open(work: () => Promise<SendProblem | null>) {
    setProblem(null);
    setProblem(await work());
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
  const upload = (which: "picture" | "cover") => (file: File) =>
    void open(() =>
      choose(which === "picture" ? "photo" : "cover", file, async (master, framing) => {
        const failed = await sendImage(communityId, which, { master, framing });
        if (failed === null) changed();
        return failed;
      }),
    );
  const frameAgain = (which: "picture" | "cover") => () => {
    const target: Target = { kind: which, communityId };
    const stored = which === "picture" ? community.photoFrames : community.coverFrames;
    void open(() => reframe(which === "picture" ? "photo" : "cover", target, stored, changed));
  };

  return (
    <div className="flex flex-col gap-3">
      <PicturePick
        label={strings.community_picture_choose}
        removeLabel={strings.community_picture_remove}
        chosen={null}
        disabled={busy}
        pick={upload("picture")}
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
            className="size-14 rounded-post-bubble text-xl"
          />
        }
      />
      {community.photo !== null && (
        <Button disabled={busy} onClick={frameAgain("picture")} className="self-start">
          {strings.image_frames_title}
        </Button>
      )}
      <Cover communityId={communityId} version={community.cover} className="rounded-md" />
      <PicturePick
        label={strings.community_cover_choose}
        removeLabel={strings.community_cover_remove}
        chosen={null}
        disabled={busy}
        pick={upload("cover")}
        remove={
          community.cover === null
            ? null
            : () => void run(removal(() => removeCommunityCover({ path: { communityId } })))
        }
      />
      {community.cover !== null && (
        <Button disabled={busy} onClick={frameAgain("cover")} className="self-start">
          {strings.image_frames_title}
        </Button>
      )}
      <ImageProblem problem={problem} />
      {sheet}
    </div>
  );
}
