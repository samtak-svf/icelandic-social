import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
  createImportPage,
  deleteImportPage,
  listImportPages,
  type ImportPageConnection,
  type WallAudience,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { WallAudienceFields } from "../social/audience.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { Button, Status, buttonClass } from "../ui/kit.tsx";
import { ImportProblem, useAct, usePoll } from "./shared.tsx";

// A page the person manages on another platform, connected by signing in there
// (decision 0120). Sign-in is a full-page navigation: the server sends the person
// back here with what came of it in `?page=`.

const PAGE_NOTICES = ["choose", "none", "failed", "declined"] as const;
export type PageNotice = (typeof PAGE_NOTICES)[number];

export function validateImportsSearch(search: Record<string, unknown>): { page?: PageNotice } {
  const page = PAGE_NOTICES.find((notice) => notice === search.page);
  return page === undefined ? {} : { page };
}

const NOTICE: Readonly<Record<Exclude<PageNotice, "choose">, string>> = {
  none: strings.imports_page_none,
  failed: strings.imports_page_failed,
  declined: strings.imports_page_declined,
};

const START = "/auth/page/start";

/** One connected page, with what it needs next. */
export function PageRow({
  row,
  remove,
  disabled = false,
}: Readonly<{ row: ImportPageConnection; remove: () => void; disabled?: boolean }>) {
  return (
    <li className="flex flex-col gap-2 p-3">
      <p className="font-medium">{row.pageName}</p>
      {row.state === "importing" && <p className="text-sm">{strings.imports_sync_importing}</p>}
      {row.state === "preview" && <p className="text-sm">{strings.imports_sync_preview}</p>}
      {row.state === "connected" && (
        <p className="text-sm text-muted-fg">
          {strings.imports_sync_posts({ count: row.posts })}
          {row.lastSyncAt !== null &&
            ` ${strings.imports_sync_last({ date: when(row.lastSyncAt) })}`}
        </p>
      )}
      {row.outcome === "failed" && <p className="text-sm">{strings.imports_sync_failed}</p>}
      {row.outcome === "expired" && <p className="text-sm">{strings.imports_page_expired}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {row.outcome === "expired" && (
          <a href={START} className="underline">
            {strings.imports_page_start}
          </a>
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

const loadPages = () => outcome(listImportPages(), 200);

export function PageSection({ notice }: Readonly<{ notice?: PageNotice | undefined }>) {
  const title = useId();
  const [list, reload] = useLoad(loadPages);
  const [audience, setAudience] = useState<WallAudience>("friends");
  const { busy, problem, act } = useAct(reload);
  usePoll(list?.ok === true && list.data.connections.some((r) => r.state === "importing"), reload);

  if (list === null) return null;
  if (!list.ok) {
    return (
      <Status>
        <ImportProblem problem={list.problem} />
      </Status>
    );
  }
  const { available, offers, connections } = list.data;
  if (!available && connections.length === 0) return null;
  return (
    <section aria-labelledby={title} className="mt-8">
      <h2 id={title} className="text-xl font-semibold">
        {strings.imports_page_title}
      </h2>
      <p className="mt-1 text-sm text-muted-fg">{strings.imports_page_hint}</p>
      {notice !== undefined && notice !== "choose" && <Status inline>{NOTICE[notice]}</Status>}
      {connections.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {connections.map((row) => (
            <PageRow
              key={row.importId}
              row={row}
              disabled={busy}
              remove={() => {
                if (!confirm(strings.imports_disconnect_confirm)) return;
                void act(outcome(deleteImportPage({ path: { importId: row.importId } }), 204));
              }}
            />
          ))}
        </ul>
      )}
      {offers.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <p>{strings.imports_page_choose}</p>
          <WallAudienceFields value={audience} onChange={setAudience} disabled={busy} />
          <ul className="divide-y divide-border rounded-md border border-border">
            {offers.map((offer) => (
              <li key={offer.pageId} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1 font-medium">{offer.pageName}</span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      outcome(createImportPage({ body: { pageId: offer.pageId, audience } }), 201),
                    )
                  }
                >
                  {strings.imports_page_connect}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {available && offers.length === 0 && (
        <p className="mt-3">
          <a href={START} className={`inline-flex items-center ${buttonClass("quiet")}`}>
            {strings.imports_page_start}
          </a>
        </p>
      )}
      <Status inline>{problem !== null && <ImportProblem problem={problem} />}</Status>
    </section>
  );
}
