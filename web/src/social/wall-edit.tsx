import { useId, useState, type ChangeEvent } from "react";
import { useAccount } from "../account.tsx";
import { refused } from "../problem.ts";
import { getAccount, removePhoto, removeWallCover, setBio } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button } from "../ui/kit.tsx";
import { useFrameSession } from "./frame-session.tsx";
import { putFramed, type SendProblem } from "./frame-send.ts";
import { ImageProblem } from "./image-problem.tsx";
import { outcome } from "./outcome.ts";
import { PicturePick } from "./picture-pick.tsx";
import { bioTooLong, cleanBio } from "./wall-bio.ts";

// What the owner of a wall changes on it (decision 0115): the bio, the cover
// and the photo. A suspended account may still clear its bio and take its
// cover away, and nothing else of these (the server refuses the rest).

/** The bio line, with the owner's way to write it, replace it or clear it. */
export function BioLine({
  bio,
  owner,
  suspended,
  changed,
}: Readonly<{ bio: string | null; owner: boolean; suspended: boolean; changed: () => void }>) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bio ?? "");
  const [problem, setProblem] = useState<SendProblem | null>(null);
  async function save(next: string) {
    setProblem(null);
    const done = await outcome(setBio({ body: { bio: next } }), 204);
    if (done.ok) {
      setEditing(false);
      changed();
    } else setProblem(done.problem);
  }
  if (!owner) return bio === null ? null : <p className="break-words">{bio}</p>;
  if (!editing) {
    return (
      <div className="flex flex-col items-start gap-2">
        {bio !== null && <p className="break-words">{bio}</p>}
        <div className="flex flex-wrap gap-2">
          {!suspended && (
            <Button
              onClick={() => {
                setValue(bio ?? "");
                setEditing(true);
              }}
            >
              {strings.wall_bio_label}
            </Button>
          )}
          {bio !== null && (
            <Button tone="danger" onClick={() => void save("")}>
              {strings.delete}
            </Button>
          )}
        </div>
        <ImageProblem problem={problem} />
      </div>
    );
  }
  const tooLong = bioTooLong(value);
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooLong) void save(cleanBio(value));
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {strings.wall_bio_label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={strings.wall_bio_placeholder}
        aria-invalid={tooLong}
        onChange={(event) => setValue(event.target.value.replace(/[\r\n]+/g, " "))}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
      {tooLong && <p role="alert">{strings.wall_bio_too_long}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => setEditing(false)}>{strings.cancel}</Button>
        <Button tone="primary" type="submit" disabled={tooLong}>
          {strings.save}
        </Button>
      </div>
      <ImageProblem problem={problem} />
    </form>
  );
}

/** Set, frame and remove the cover; setting and framing are not offered to a suspended account. */
export function CoverControls({
  cover,
  coverFrames,
  suspended,
  changed,
}: Readonly<{
  cover: string | null;
  coverFrames: Parameters<ReturnType<typeof useFrameSession>["reframe"]>[2];
  suspended: boolean;
  changed: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const { sheet, choose, reframe } = useFrameSession();
  const upload = (file: File) => {
    setProblem(null);
    void choose("cover", file, async (master, framing) => {
      const failed = await putFramed({ kind: "wall" }, master, framing);
      if (failed === null) changed();
      return failed;
    }).then(setProblem);
  };
  async function remove() {
    setBusy(true);
    setProblem(null);
    const done = await outcome(removeWallCover(), 204);
    setBusy(false);
    if (done.ok) changed();
    else setProblem(done.problem);
  }
  return (
    <div className="flex flex-col gap-2">
      {suspended ? (
        cover !== null && (
          <Button
            tone="danger"
            disabled={busy}
            onClick={() => void remove()}
            className="self-start"
          >
            {strings.community_cover_remove}
          </Button>
        )
      ) : (
        <>
          <PicturePick
            label={strings.community_cover_choose}
            removeLabel={strings.community_cover_remove}
            chosen={null}
            disabled={busy}
            pick={upload}
            remove={cover === null ? null : () => void remove()}
          />
          {cover !== null && (
            <Button
              disabled={busy}
              className="self-start"
              onClick={() =>
                void reframe("cover", { kind: "wall" }, coverFrames, changed).then(setProblem)
              }
            >
              {strings.image_frames_title}
            </Button>
          )}
        </>
      )}
      <ImageProblem problem={problem} />
      {sheet}
    </div>
  );
}

/** The photo's choose, reframe and remove, behind the camera badge. */
export function PhotoControls({
  accountId,
  photo,
  changed,
}: Readonly<{ accountId: string; photo: string | null; changed: () => void }>) {
  const { refresh } = useAccount();
  const input = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const { sheet, choose, reframe } = useFrameSession();
  const done = () => {
    void refresh();
    changed();
  };

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    setProblem(
      await choose("photo", file, async (master, framing) => {
        const failed = await putFramed({ kind: "account" }, master, framing);
        if (failed === null) done();
        return failed;
      }),
    );
  }

  async function frameAgain() {
    setProblem(null);
    const profile = await getAccount({ path: { accountId } }).catch(() => null);
    const stored = profile?.status === 200 ? profile.data.photoFrames : null;
    setProblem(await reframe("photo", { kind: "account" }, stored, done));
  }

  async function remove() {
    if (!confirm(strings.photo_remove_confirm)) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await removePhoto();
      if (answer.status === 204) done();
      else setProblem(refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap gap-3">
        <label
          htmlFor={input}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-primary px-4 font-medium text-primary-fg has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
        >
          {photo === null ? strings.photo_choose : strings.photo_change}
          <input
            id={input}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload(event)}
          />
        </label>
        {photo !== null && (
          <Button disabled={busy} onClick={() => void frameAgain()}>
            {strings.image_frames_title}
          </Button>
        )}
        {photo !== null && (
          <Button tone="danger" disabled={busy} onClick={() => void remove()}>
            {strings.photo_remove}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-fg">{strings.photo_seen_by_all}</p>
      <ImageProblem problem={problem} />
      {sheet}
    </section>
  );
}
