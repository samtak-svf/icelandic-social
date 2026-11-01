import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useMemo, useState } from "react";
import {
  deleteImport,
  getImport,
  listImportItems,
  publishImport,
  type ImportItem,
  type ImportStatus,
  type WallAudience,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import type { Problem } from "../problem.ts";
import { WallAudienceFields } from "../social/audience.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { usePaged, type Paged } from "../social/paged.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { CLASS_LABEL, ClassFields, DEFAULT_CLASSES, LostList, type ItemClass } from "./classes.tsx";
import { failureSentence, usePoll } from "./shared.tsx";
import { LIMITS } from "../generated/limits.ts";

// One import (decisions 0119, 0120): what was read and, while it waits, the choice of
// what to publish. Nothing is published until the person says so, and a whole
// import can always be taken back.

/** Most posts one publication can leave out; the API refuses more. */
export const MOST_EXCLUDED = LIMITS.excludedPostsCount;

const WAITING: readonly ImportStatus["state"][] = ["parsing", "publishing", "removing"];

/** The start of a day, read from a date field, in milliseconds; undefined when empty. */
export function dayStart(day: string): number | undefined {
  return day === "" ? undefined : Date.parse(`${day}T00:00:00.000Z`);
}

/** The end of a day, read from a date field, in milliseconds; undefined when empty. */
export function dayEnd(day: string): number | undefined {
  return day === "" ? undefined : Date.parse(`${day}T23:59:59.999Z`);
}

const toDay = (ms: number | null) =>
  ms === null ? undefined : new Date(ms).toISOString().slice(0, 10);

const STATE_SENTENCE = {
  uploading: strings.imports_unfinished,
  parsing: strings.imports_wait_parsing,
  publishing: strings.imports_wait_publishing,
  removing: strings.imports_wait_removing,
  done: strings.imports_done,
} as const;

/** The sentence for an import that is not waiting for a choice. */
export function stateSentence(status: ImportStatus): string | null {
  if (status.state === "ready") return null;
  if (status.state === "failed") return failureSentence(status.failure);
  return STATE_SENTENCE[status.state];
}

export type Choice = {
  from: string;
  to: string;
  excluded: ReadonlySet<string>;
  audience: WallAudience;
  classes: ReadonlySet<ItemClass>;
};

/** Which of the items read so far are of a chosen kind and inside the chosen range. */
export function inChoice(items: readonly ImportItem[], choice: Choice): ImportItem[] {
  const from = dayStart(choice.from) ?? -Infinity;
  const to = dayEnd(choice.to) ?? Infinity;
  return items.filter((item) => choice.classes.has(item.class) && item.at >= from && item.at <= to);
}

/** What the person chooses from: kinds of post, range, posts, audience. Draws what it is given. */
export function ChoiceView({
  status,
  list,
  choice,
  change,
  publish,
  busy = false,
}: Readonly<{
  status: ImportStatus;
  list: Paged<ImportItem>;
  choice: Choice;
  change: (next: Choice) => void;
  publish: () => void;
  busy?: boolean;
}>) {
  const { counts } = status;
  const fromId = useId();
  const toId = useId();
  const shown = inChoice(list.items ?? [], choice);
  const noClass = choice.classes.size === 0;
  const full = choice.excluded.size >= MOST_EXCLUDED;
  const bounds = { min: toDay(counts.earliest), max: toDay(counts.latest) };
  const dateClass = "min-h-11 rounded-md border border-border-strong bg-surface px-3";

  function toggle(id: string, include: boolean) {
    const excluded = new Set(choice.excluded);
    if (include) excluded.delete(id);
    else excluded.add(id);
    change({ ...choice, excluded });
  }

  return (
    <>
      <ClassFields
        status={status}
        chosen={choice.classes}
        change={(classes) => change({ ...choice, classes })}
        disabled={busy}
      />
      <LostList status={status} chosen={choice.classes} />
      {counts.skipped > 0 && (
        <p className="mt-1 text-sm text-muted-fg">
          {strings.imports_skipped({ count: counts.skipped })}
        </p>
      )}
      <p className="mt-1 text-sm text-muted-fg">{strings.imports_preview_kept}</p>
      <fieldset className="mt-4 flex flex-wrap items-end gap-3" disabled={busy}>
        <legend className="text-sm font-medium">{strings.imports_range}</legend>
        <span className="flex flex-col gap-1">
          <label htmlFor={fromId} className="text-sm">
            {strings.imports_from}
          </label>
          <input
            id={fromId}
            type="date"
            className={dateClass}
            value={choice.from}
            {...bounds}
            onChange={(event) => change({ ...choice, from: event.target.value })}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={toId} className="text-sm">
            {strings.imports_to}
          </label>
          <input
            id={toId}
            type="date"
            className={dateClass}
            value={choice.to}
            {...bounds}
            onChange={(event) => change({ ...choice, to: event.target.value })}
          />
        </span>
      </fieldset>
      {list.items === null ? (
        <Status>
          {list.problem === null ? strings.loading : <ProblemText problem={list.problem} />}
        </Status>
      ) : (
        <>
          {noClass && <p className="mt-4 text-muted-fg">{strings.imports_no_class}</p>}
          {!noClass && shown.length === 0 && !list.hasMore && (
            <p className="mt-4 text-muted-fg">{strings.imports_empty_range}</p>
          )}
          <ul className="mt-4 divide-y divide-border rounded-md border border-border empty:hidden">
            {shown.map((item) => {
              const included = !choice.excluded.has(item.id);
              return (
                <li key={item.id} className="flex flex-col gap-1 p-3">
                  <p className="text-sm text-muted-fg">
                    {formatIsDate(item.at)}
                    {item.images > 0 && ` · ${strings.imports_item_images({ count: item.images })}`}
                    {item.class !== "own" && ` · ${CLASS_LABEL[item.class]}`}
                  </p>
                  <p className="line-clamp-6 whitespace-pre-wrap wrap-anywhere">{item.text}</p>
                  {item.hasVideo && <p className="text-sm">{strings.imports_item_video}</p>}
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={busy || (included && full)}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                    />
                    {strings.imports_include}
                  </label>
                </li>
              );
            })}
          </ul>
          {list.hasMore && !noClass && <div ref={list.sentinel} />}
          {list.problem !== null && (
            <Status>
              <ProblemText problem={list.problem} />
            </Status>
          )}
        </>
      )}
      {full && <p className="mt-2 text-sm">{strings.imports_excluded_full}</p>}
      <div className="mt-4 flex flex-col gap-3">
        <WallAudienceFields
          value={choice.audience}
          onChange={(audience) => change({ ...choice, audience })}
          disabled={busy}
        />
        <div>
          <Button tone="primary" onClick={publish} disabled={busy || noClass}>
            {strings.imports_publish}
          </Button>
        </div>
      </div>
    </>
  );
}

/** The choice, wired to the API. */
function Chooser({
  importId,
  status,
  published,
}: Readonly<{ importId: string; status: ImportStatus; published: () => void }>) {
  const fetchPage = useCallback(
    async (before: string | undefined) => {
      const query = before === undefined ? {} : { cursor: before };
      const page = await outcome(listImportItems({ path: { importId }, query }), 200);
      return page.ok
        ? { ok: true as const, data: { posts: page.data.items, next: page.data.next } }
        : page;
    },
    [importId],
  );
  const list = usePaged<ImportItem>(fetchPage, (item) => item.id);
  const [choice, setChoice] = useState<Choice>({
    from: "",
    to: "",
    excluded: new Set(),
    audience: "friends",
    classes: DEFAULT_CLASSES,
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function publish() {
    setBusy(true);
    setProblem(null);
    const from = dayStart(choice.from);
    const to = dayEnd(choice.to);
    const done = await outcome(
      publishImport({
        path: { importId },
        body: {
          audience: choice.audience,
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          excluded: [...choice.excluded],
          classes: [...choice.classes],
        },
      }),
      204,
    );
    setBusy(false);
    if (done.ok) published();
    else setProblem(done.problem);
  }

  return (
    <>
      <ChoiceView
        status={status}
        list={list}
        choice={choice}
        change={setChoice}
        publish={() => void publish()}
        busy={busy}
      />
      <Status inline>{problem !== null && <ProblemText problem={problem} />}</Status>
    </>
  );
}

/** The screen of one import. */
export function ImportPreview({ importId }: Readonly<{ importId: string }>) {
  const navigate = useNavigate();
  const load = useCallback(() => outcome(getImport({ path: { importId } }), 200), [importId]);
  const [status, reload] = useLoad(load);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [removing, setRemoving] = useState(false);
  const current = status?.ok === true ? status.data : null;
  const waiting = useMemo(() => current !== null && WAITING.includes(current.state), [current]);
  usePoll(waiting, reload);

  async function remove() {
    if (!confirm(strings.imports_remove_confirm)) return;
    setRemoving(true);
    setProblem(null);
    const removed = await outcome(deleteImport({ path: { importId } }), 204);
    setRemoving(false);
    if (removed.ok) void navigate({ to: "/imports" });
    else setProblem(removed.problem);
  }

  const sentence = current === null ? null : stateSentence(current);
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.imports_preview_title}</h1>
      <p className="mt-2">
        <Link to="/imports" className="underline">
          {strings.imports_back}
        </Link>
      </p>
      {status === null && <Status>{strings.loading}</Status>}
      {status?.ok === false && (
        <Status>
          <ProblemText problem={status.problem} />
        </Status>
      )}
      {sentence !== null && <p className="mt-4">{sentence}</p>}
      {current?.state === "ready" && (
        <Chooser importId={importId} status={current} published={reload} />
      )}
      {current !== null && current.state !== "removing" && (
        <div className="mt-6">
          <Button tone="danger" onClick={() => void remove()} disabled={removing}>
            {strings.imports_remove}
          </Button>
        </div>
      )}
      <Status inline>{problem !== null && <ProblemText problem={problem} />}</Status>
    </>
  );
}
