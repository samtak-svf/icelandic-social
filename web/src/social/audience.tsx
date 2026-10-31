import { useId, useState } from "react";
import type { Problem } from "../problem.ts";
import { setPostAudience, type WallAudience } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";

// Who may read a post on a wall (decision 0115): the author's friends, or every
// signed-in account. The picker is used by the composer and, afterwards, by the
// dialog that changes it.

const LABEL: Record<WallAudience, string> = {
  friends: strings.wall_audience_friends,
  everyone: strings.wall_audience_everyone,
};

const ORDER: readonly WallAudience[] = ["friends", "everyone"];

/** The two choices as radios; `friends` is where a new post starts. */
export function AudienceChoice({
  value,
  onChange,
  disabled = false,
}: Readonly<{ value: WallAudience; onChange: (next: WallAudience) => void; disabled?: boolean }>) {
  const name = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4" disabled={disabled}>
      <legend className="text-sm font-medium">{strings.wall_audience_label}</legend>
      {ORDER.map((audience) => (
        <label key={audience} className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name={name}
            value={audience}
            checked={value === audience}
            onChange={() => onChange(audience)}
          />
          {LABEL[audience]}
        </label>
      ))}
    </fieldset>
  );
}

/** The small icon and word on a wall post the reader may read; nothing on any other post. */
export function AudienceMark({ audience }: Readonly<{ audience: WallAudience | undefined }>) {
  if (audience === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1" data-audience={audience}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {audience === "friends" ? (
          <>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            <path d="M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.8 3 2.5 3 5.5" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z" />
          </>
        )}
      </svg>
      <span className="sr-only">{strings.wall_audience_label}: </span>
      {LABEL[audience]}
    </span>
  );
}

/** The dialog behind the author's "who reads this" menu item. */
export function AudienceDialog({
  postId,
  current,
  onClose,
  changed,
}: Readonly<{ postId: string; current: WallAudience; onClose: () => void; changed: () => void }>) {
  const [audience, setAudience] = useState<WallAudience>(current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function save() {
    setBusy(true);
    setProblem(null);
    const done = await outcome(setPostAudience({ path: { postId }, body: { audience } }), 204);
    setBusy(false);
    if (done.ok) {
      onClose();
      changed();
    } else setProblem(done.problem);
  }
  return (
    <Dialog title={strings.wall_audience_label} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <AudienceChoice value={audience} onChange={setAudience} disabled={busy} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{strings.cancel}</Button>
          <Button
            tone="primary"
            disabled={busy || audience === current}
            onClick={() => void save()}
          >
            {strings.save}
          </Button>
        </div>
        <Status>{problem !== null && <ProblemText problem={problem} />}</Status>
      </div>
    </Dialog>
  );
}

/** The wall composer's two additions to a post form: who reads it, and that it is not encrypted. */
export function WallAudienceFields(props: Readonly<Parameters<typeof AudienceChoice>[0]>) {
  return (
    <>
      <AudienceChoice {...props} />
      <p className="text-sm text-muted-fg">{strings.wall_not_encrypted_notice}</p>
    </>
  );
}
