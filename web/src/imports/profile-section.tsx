import { Link } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import {
  checkImportConnection,
  createImportConnection,
  deleteImportConnection,
  listImportConnections,
  type ImportConnection,
  type WallAudience,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { WallAudienceFields } from "../social/audience.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { Button, Status } from "../ui/kit.tsx";
import { ImportProblem, usePoll } from "./shared.tsx";

// A public profile on another platform, proven the person's own by a posted code
// (decision 0120). The section is drawn only when the route is open, or when the
// person already holds a connection they can remove.

const NAMES = {
  invalid_request: strings.imports_profile_invalid,
  conflict: strings.imports_profile_limit,
  unavailable: strings.imports_profile_off,
};

/** What a connection is doing, as a sentence; a preview links on from the row. */
export function connectionSentence(row: ImportConnection): string | null {
  if (row.state === "checking") return strings.imports_profile_checking;
  if (row.state === "importing") return strings.imports_sync_importing;
  if (row.state === "preview") return strings.imports_sync_preview;
  if (row.outcome === "capped") return strings.imports_sync_capped;
  if (row.state === "unproven") {
    return row.outcome === "not_found" ? strings.imports_profile_not_found : null;
  }
  return row.outcome === "failed" ? strings.imports_sync_failed : null;
}

/** One connection, with what it needs next. */
export function ConnectionRow({
  row,
  check,
  remove,
  disabled = false,
}: Readonly<{
  row: ImportConnection;
  check: () => void;
  remove: () => void;
  disabled?: boolean;
}>) {
  const sentence = connectionSentence(row);
  return (
    <li className="flex flex-col gap-2 p-3">
      <p className="break-all font-medium">{row.profileUrl}</p>
      {row.state === "unproven" && row.code !== null && (
        <>
          <p className="text-sm">{strings.imports_profile_code}</p>
          <p>
            <code className="select-all rounded-md bg-surface px-2 py-1 font-mono text-lg">
              {row.code}
            </code>
          </p>
        </>
      )}
      {sentence !== null && <p className="text-sm">{sentence}</p>}
      {row.state === "connected" && (
        <p className="text-sm text-muted-fg">
          {strings.imports_sync_posts({ count: row.posts })}
          {row.lastSyncAt !== null &&
            ` ${strings.imports_sync_last({ date: when(row.lastSyncAt) })}`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {row.state === "unproven" && (
          <Button onClick={check} disabled={disabled}>
            {strings.imports_profile_check}
          </Button>
        )}
        {row.state === "preview" && (
          <Link to="/imports/$importId" params={{ importId: row.importId }} className="underline">
            {strings.imports_preview_link}
          </Link>
        )}
        <Button tone="danger" onClick={remove} disabled={disabled}>
          {strings.imports_disconnect}
        </Button>
      </div>
    </li>
  );
}

const loadConnections = () => outcome(listImportConnections(), 200);

export function ProfileSection() {
  const title = useId();
  const [list, reload] = useLoad(loadConnections);
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<WallAudience>("friends");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const working =
    list?.ok === true &&
    list.data.connections.some((row) => row.state === "checking" || row.state === "importing");
  usePoll(working, reload);

  const act = useCallback(
    async (pending: Promise<{ ok: true; data: unknown } | { ok: false; problem: Problem }>) => {
      setBusy(true);
      setProblem(null);
      const result = await pending;
      setBusy(false);
      if (!result.ok) setProblem(result.problem);
      reload();
      return result.ok;
    },
    [reload],
  );

  async function connect(event: FormEvent) {
    event.preventDefault();
    const body = { profileUrl: url.trim(), audience };
    if (await act(outcome(createImportConnection({ body }), 201))) setUrl("");
  }

  if (list === null) return null;
  if (!list.ok) {
    return (
      <Status>
        <ImportProblem problem={list.problem} />
      </Status>
    );
  }
  const { available, connections } = list.data;
  if (!available && connections.length === 0) return null;
  return (
    <section aria-labelledby={title} className="mt-8">
      <h2 id={title} className="text-xl font-semibold">
        {strings.imports_profile_title}
      </h2>
      <p className="mt-1 text-sm text-muted-fg">{strings.imports_profile_hint}</p>
      {connections.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {connections.map((row) => (
            <ConnectionRow
              key={row.importId}
              row={row}
              disabled={busy}
              check={() =>
                void act(outcome(checkImportConnection({ path: { importId: row.importId } }), 202))
              }
              remove={() => {
                if (!confirm(strings.imports_disconnect_confirm)) return;
                void act(
                  outcome(deleteImportConnection({ path: { importId: row.importId } }), 204),
                );
              }}
            />
          ))}
        </ul>
      )}
      {available && (
        <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void connect(event)}>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{strings.imports_profile_url}</span>
            <input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
            />
          </label>
          <WallAudienceFields value={audience} onChange={setAudience} disabled={busy} />
          <div>
            <Button tone="primary" type="submit" disabled={busy}>
              {strings.imports_profile_connect}
            </Button>
          </div>
        </form>
      )}
      <Status inline>
        {problem !== null && <ImportProblem problem={problem} names={NAMES} />}
      </Status>
    </section>
  );
}
