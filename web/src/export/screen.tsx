import { useState } from "react";
import { createExport, getExportFile, listExports, type ExportSummary } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { refused, type Problem } from "../problem.ts";
import { usePoll } from "../imports/shared.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// A person takes their own content out (decision 0126): ask for a file, wait while a job
// builds it, download it before it expires.

const FAILURES: Readonly<Record<string, string>> = { too_big: strings.export_failed_too_big };

/** A refusal in the sentence for its code, else the app's general words. */
export function ExportProblem({ problem }: Readonly<{ problem: Problem }>) {
  if (problem.kind === "refused" && problem.code === "conflict") {
    return <span>{strings.export_conflict}</span>;
  }
  return <ProblemText problem={problem} />;
}

/** What the newest export says, in words; nothing before the first one is asked for. */
export function ExportState({
  row,
  onDownload,
  busy,
}: Readonly<{ row: ExportSummary; onDownload: () => void; busy: boolean }>) {
  if (row.state === "building") return <p>{strings.export_building}</p>;
  if (row.state === "failed") {
    return (
      <p>{(row.failure === null ? undefined : FAILURES[row.failure]) ?? strings.export_failed}</p>
    );
  }
  return (
    <>
      <p>{strings.export_ready({ date: formatIsDate(row.expiresAt) })}</p>
      <Button tone="primary" className="mt-3" disabled={busy} onClick={onDownload}>
        {strings.export_download}
      </Button>
    </>
  );
}

const loadExports = () => outcome(listExports(), 200);

/** Saves the bytes as a file; the browser names it from the download attribute. */
function save(blob: Blob) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "export.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function ExportScreen() {
  const [list, reload] = useLoad(loadExports);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const newest = list?.ok === true ? list.data.exports[0] : undefined;
  usePoll(newest?.state === "building", reload);

  async function ask() {
    setBusy(true);
    setProblem(null);
    const made = await outcome(createExport(), 201);
    setBusy(false);
    if (!made.ok) setProblem(made.problem);
    reload();
  }

  async function download(exportId: string) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await getExportFile({ path: { exportId } });
      if (answer.status === 200) save(answer.data);
      else setProblem(answer.status === 416 ? { kind: "unreachable" } : refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    }
    setBusy(false);
    reload();
  }

  return (
    <>
      <h1 className="font-headline text-3xl">{strings.export_title}</h1>
      <p className="mt-2">{strings.export_intro}</p>
      <p className="mt-2">{strings.export_left_out}</p>
      <p className="mt-2">{strings.export_images_note}</p>
      <p className="mt-2 font-medium">{strings.export_anonymous_warning}</p>
      <div className="mt-6">
        {newest === undefined || newest.state === "failed" ? (
          <Button tone="primary" disabled={busy || list === null} onClick={() => void ask()}>
            {strings.export_start}
          </Button>
        ) : null}
        <Status>
          {newest !== undefined && (
            <ExportState
              row={newest}
              busy={busy}
              onDownload={() => void download(newest.exportId)}
            />
          )}
          {list?.ok === false && <ExportProblem problem={list.problem} />}
          {problem !== null && <ExportProblem problem={problem} />}
        </Status>
      </div>
    </>
  );
}
