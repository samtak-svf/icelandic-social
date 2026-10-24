import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { useAccount } from "../account.tsx";
import { refused } from "../problem.ts";
import { getAccount, getPhoto, removePhoto, type Me } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { useFrameSession } from "../social/frame-session.tsx";
import { putFramed, type SendProblem } from "../social/frame-send.ts";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { VerifyCta } from "../ui/verify.tsx";

// Ég (decisions 0034, 0039): the name, its mark or the way to it (0069), and
// the photo. The photo is the one thing here the person changes; the name
// comes from Google or from Kenni, and is never typed (decision 0043).
export const Route = createFileRoute("/")({ component: MePage });

function MePage() {
  const { state } = useAccount();
  if (state.status !== "signed-in") {
    return (
      <>
        <h1 className="sr-only">{strings.tab_me}</h1>
        <Status>{strings.loading}</Status>
      </>
    );
  }
  const { me } = state;
  return (
    <>
      <h1 className="sr-only">{strings.tab_me}</h1>
      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar me={me} />
        <p className="text-2xl font-semibold">{me.name ?? strings.person_unnamed}</p>
        {me.verified && (
          <p>
            <VerifiedMark />
          </p>
        )}
        <VerifyCta />
      </section>
      <PhotoControls me={me} />
    </>
  );
}

/** The photo, fetched with the client header the API asks of every call, or the initials. */
function Avatar({ me }: Readonly<{ me: Me }>) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (me.photo === null) return undefined;
    let url: string | null = null;
    let live = true;
    void getPhoto({ path: { accountId: me.accountId } })
      .then((answer) => {
        if (!live || answer.status !== 200) return;
        url = URL.createObjectURL(answer.data);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [me.accountId, me.photo]);
  const box = "size-32 rounded-full";
  if (me.photo !== null && src !== null) {
    return <img src={src} alt={strings.photo_own_alt} className={`${box} object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} flex items-center justify-center bg-muted text-4xl font-semibold`}
    >
      {initials(me.name)}
    </span>
  );
}

function initials(name: string | null): string {
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("is");
}

function PhotoControls({ me }: Readonly<{ me: Me }>) {
  const { refresh } = useAccount();
  const input = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const { sheet, choose, reframe } = useFrameSession();

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    setProblem(
      await choose("photo", file, async (master, framing) => {
        const failed = await putFramed({ kind: "account" }, master, framing);
        if (failed === null) await refresh();
        return failed;
      }),
    );
  }

  async function frameAgain() {
    setProblem(null);
    // Me carries no framing; the own profile does, so the sheet reopens where it was left.
    const profile = await getAccount({ path: { accountId: me.accountId } }).catch(() => null);
    const stored = profile?.status === 200 ? profile.data.photoFrames : null;
    setProblem(await reframe("photo", { kind: "account" }, stored, () => void refresh()));
  }

  async function remove() {
    if (!confirm(strings.photo_remove_confirm)) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await removePhoto();
      if (answer.status === 204) await refresh();
      else setProblem(refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    } finally {
      setBusy(false);
    }
  }

  const label = me.photo === null ? strings.photo_choose : strings.photo_change;
  return (
    <section className="mt-8 flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-3">
        <label
          htmlFor={input}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-primary px-4 font-medium text-primary-fg has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
        >
          {label}
          <input
            id={input}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload(event)}
          />
        </label>
        {me.photo !== null && (
          <Button disabled={busy} onClick={() => void frameAgain()}>
            {strings.image_frames_title}
          </Button>
        )}
        {me.photo !== null && (
          <Button tone="danger" disabled={busy} onClick={() => void remove()}>
            {strings.photo_remove}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-fg">{strings.photo_seen_by_all}</p>
      <Status>
        {busy
          ? strings.loading
          : problem === "no_master"
            ? strings.image_frames_no_master
            : typeof problem === "string"
              ? strings.photo_upload_failed
              : problem !== null && <ProblemText problem={problem} />}
      </Status>
      {sheet}
    </section>
  );
}
