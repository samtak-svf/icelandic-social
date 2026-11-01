import { useNavigate } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
import { createCommunity } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Framing } from "../generated/frames.ts";
import { useFrameSession } from "./frame-session.tsx";
import type { SendProblem } from "./frame-send.ts";
import { CommunityPreview } from "./community-preview.tsx";
import { ImageProblem } from "./image-problem.tsx";
import { useObjectUrl } from "./object-url.ts";
import { outcome } from "./outcome.ts";
import { PicturePick, sendImage } from "./picture-pick.tsx";
import { useSuspended } from "./suspended.tsx";
import { Button } from "../ui/kit.tsx";
import { LIMITS } from "../generated/limits.ts";
import { clipText } from "../lib/char-count.ts";

// `community_create` (decisions 0063, 0080): the name, the description, the
// audience and, if wanted, a picture and a cover. The community is made
// first and the chosen images are sent to it after; one that fails leaves the
// community made and says so, and `community_edit` is where to try again. On
// an expanded window (decision 0087) the form sits beside a live preview of
// the header, with the chosen pictures shown in place before Stofna.

/** An image chosen and framed, held until the community exists to receive it. */
type Chosen = { name: string; master: Blob; framing: Framing | null };

export function CreateCommunity() {
  const suspended = useSuspended();
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"open" | "private">("open");
  const [picture, setPicture] = useState<Chosen | null>(null);
  const [cover, setCover] = useState<Chosen | null>(null);
  const { sheet, choose } = useFrameSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);

  async function frame(kind: "photo" | "cover", file: File, set: (chosen: Chosen | null) => void) {
    setProblem(null);
    setProblem(
      await choose(kind, file, (master, framing) => {
        set({ name: file.name, master, framing });
        return Promise.resolve(null);
      }),
    );
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const made = await outcome(
      createCommunity({ body: { name: name.trim(), description: description.trim(), audience } }),
      200,
    );
    if (!made.ok) {
      setBusy(false);
      setProblem(made.problem);
      return;
    }
    const communityId = made.data.communityId;
    // The community exists now: a picture that does not go up is shown to
    // the person on the community's own page, where it can be tried again.
    if (picture !== null) await sendImage(communityId, "picture", picture);
    if (cover !== null) await sendImage(communityId, "cover", cover);
    setBusy(false);
    await navigate({ to: "/communities/$communityId", params: { communityId } });
  }

  const images = {
    photo: useObjectUrl(picture?.master ?? null),
    cover: useObjectUrl(cover?.master ?? null),
  };
  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <div className="expanded:grid expanded:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] expanded:items-start expanded:gap-8">
      <form onSubmit={(event) => void create(event)} className="mt-4 flex flex-col gap-2">
        <PicturePick
          label={strings.community_picture_choose}
          removeLabel={strings.community_picture_remove}
          chosen={picture?.name ?? null}
          disabled={busy}
          pick={(file) => void frame("photo", file, setPicture)}
          remove={picture === null ? null : () => setPicture(null)}
        />
        <PicturePick
          label={strings.community_cover_choose}
          removeLabel={strings.community_cover_remove}
          chosen={cover?.name ?? null}
          disabled={busy}
          pick={(file) => void frame("cover", file, setCover)}
          remove={cover === null ? null : () => setCover(null)}
        />
        <label htmlFor={`${id}-name`}>{strings.community_name}</label>
        <input
          id={`${id}-name`}
          required
          value={name}
          onChange={(event) => setName(clipText(event.target.value, LIMITS.communityNameChars))}
          className={field}
        />
        <label htmlFor={`${id}-description`}>{strings.community_description}</label>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(event) =>
            setDescription(clipText(event.target.value, LIMITS.communityDescriptionChars))
          }
          className={`${field} py-2`}
        />
        <fieldset className="flex flex-col">
          {(["open", "private"] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === value}
                onChange={() => setAudience(value)}
              />
              <span>
                <span className="font-semibold">
                  {value === "open" ? strings.community_open : strings.community_private}
                </span>
                {": "}
                {value === "open" ? strings.community_open_hint : strings.community_private_hint}
              </span>
            </label>
          ))}
        </fieldset>
        <Button tone="primary" type="submit" disabled={busy || suspended || name.trim() === ""}>
          {strings.community_create}
        </Button>
        <ImageProblem problem={problem} />
        {sheet}
      </form>
      <CommunityPreview draft={{ name, description, audience }} images={images} />
    </div>
  );
}
