import { useHydrated, useNavigate } from "@tanstack/react-router";
import { useId, useState, type ChangeEvent } from "react";
import {
  completeImport,
  createImportFile,
  putImportPart,
  type ImportFileUpload,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { outcome } from "../social/outcome.ts";
import { Button, Status } from "../ui/kit.tsx";
import { ImportProblem } from "./shared.tsx";
import { partBounds, sendParts, worthRetrying } from "./upload.ts";

// Sending an export file. A stopped upload keeps its parts, and the File stays in
// memory, so carrying on needs no second choice of the file. Leaving the page
// loses that: the earlier-files list then offers only to remove it.

const NAMES = {
  too_large: strings.imports_file_too_large,
  expired: strings.imports_file_expired,
};

type Sending = { file: File; upload: ImportFileUpload; done: Set<number> };

export function FileSection() {
  const navigate = useNavigate();
  // A file chosen before the page answers would be lost without a word.
  const hydrated = useHydrated();
  const input = useId();
  const [sending, setSending] = useState<Sending | null>(null);
  const [stored, setStored] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function run(current: Sending) {
    setBusy(true);
    setProblem(null);
    const { file, upload, done } = current;
    const importId = upload.importId;
    const plan = { size: file.size, partSize: upload.partSize, parts: upload.parts };
    const sent = await sendParts({
      plan,
      done,
      send: (part) => {
        const [start, end] = partBounds(plan, part);
        return outcome(
          putImportPart({ path: { importId, part }, body: file.slice(start, end) }),
          204,
        );
      },
      onPart: setStored,
    });
    const finished = sent.ok ? await outcome(completeImport({ path: { importId } }), 204) : sent;
    setBusy(false);
    // A repeated finish, after an answer that got lost, finds the upload already complete.
    const already =
      !finished.ok && finished.problem.kind === "refused" && finished.problem.code === "conflict";
    if (finished.ok || already) {
      setSending(null);
      void navigate({ to: "/imports/$importId", params: { importId } });
      return;
    }
    if (!worthRetrying(finished.status)) setSending(null);
    setProblem(finished.problem);
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setBusy(true);
    setProblem(null);
    setStored(0);
    const created = await outcome(createImportFile({ body: { size: file.size } }), 201);
    if (!created.ok) {
      setBusy(false);
      setProblem(created.problem);
      return;
    }
    const current = { file, upload: created.data, done: new Set<number>() };
    setSending(current);
    await run(current);
  }

  return (
    <section aria-labelledby={`${input}-title`} className="mt-6">
      <h2 id={`${input}-title`} className="text-xl font-semibold">
        {strings.imports_file_title}
      </h2>
      <p className="mt-1 text-sm text-muted-fg">{strings.imports_file_hint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {sending === null && (
          <>
            <input
              id={input}
              type="file"
              accept=".zip,application/zip"
              className="peer sr-only"
              disabled={busy || !hydrated}
              onChange={(event) => void choose(event)}
            />
            <label
              htmlFor={input}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong bg-surface px-4 font-medium peer-focus-visible:outline-2"
            >
              {strings.imports_file_choose}
            </label>
          </>
        )}
        {sending !== null && !busy && (
          <Button onClick={() => void run(sending)}>{strings.imports_file_resume}</Button>
        )}
      </div>
      <Status inline>
        {sending !== null &&
          busy &&
          strings.imports_file_sending({
            part: String(Math.min(stored + 1, sending.upload.parts)),
            parts: String(sending.upload.parts),
          })}
        {sending !== null && !busy && strings.imports_file_stalled}
        {problem !== null && sending === null && <ImportProblem problem={problem} names={NAMES} />}
      </Status>
    </section>
  );
}
