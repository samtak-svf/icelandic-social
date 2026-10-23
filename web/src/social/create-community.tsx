import { useNavigate } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import { createCommunity } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome } from "./outcome.ts";
import { ImageProblem, PicturePick, sendImage, tooLarge } from "./picture-pick.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// Stofna samfélag (decisions 0063, 0080): the name, the description, the
// audience and, if wanted, a picture and a cover. The community is made
// first and the chosen images are sent to it after; one that fails leaves the
// community made and says so, and Breyta samfélagi is where to try again.

export function CreateCommunity() {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"open" | "private">("open");
  const [picture, setPicture] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | "too_large" | "invalid_image" | null>(null);

  function choose(file: File, set: (file: File) => void) {
    if (tooLarge(file)) setProblem("too_large");
    else {
      setProblem(null);
      set(file);
    }
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

  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <form onSubmit={(event) => void create(event)} className="mt-4 flex flex-col gap-2">
      <PicturePick
        label={strings.community_picture_choose}
        removeLabel={strings.community_picture_remove}
        chosen={picture?.name ?? null}
        disabled={busy}
        pick={(file) => choose(file, setPicture)}
        remove={picture === null ? null : () => setPicture(null)}
      />
      <PicturePick
        label={strings.community_cover_choose}
        removeLabel={strings.community_cover_remove}
        chosen={cover?.name ?? null}
        disabled={busy}
        pick={(file) => choose(file, setCover)}
        remove={cover === null ? null : () => setCover(null)}
      />
      <label htmlFor={`${id}-name`}>{strings.community_name}</label>
      <input
        id={`${id}-name`}
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={field}
      />
      <label htmlFor={`${id}-description`}>{strings.community_description}</label>
      <textarea
        id={`${id}-description`}
        maxLength={500}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
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
      <Button tone="primary" type="submit" disabled={busy || name.trim() === ""}>
        {strings.community_create}
      </Button>
      {typeof problem === "string" ? (
        <ImageProblem problem={problem} />
      ) : (
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      )}
    </form>
  );
}
