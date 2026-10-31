import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { listImports, type ImportSummary } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { outcome, useLoad } from "../social/outcome.ts";
import { Status } from "../ui/kit.tsx";
import { FileSection } from "./file-section.tsx";
import { PageSection, type PageNotice } from "./page-section.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { ImportProblem, STATE_WORD, usePoll } from "./shared.tsx";

// Where a person brings their own posts in from another platform (decisions 0119,
// 0120): by file, and by whichever connections are switched on.

/** The earlier files, newest as the API gives them; nothing is drawn with none. */
export function EarlierList({ imports }: Readonly<{ imports: readonly ImportSummary[] }>) {
  const title = useId();
  if (imports.length === 0) return null;
  return (
    <section aria-labelledby={title} className="mt-8">
      <h2 id={title} className="text-xl font-semibold">
        {strings.imports_earlier_title}
      </h2>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {imports.map((row) => (
          <li key={row.importId}>
            <Link
              to="/imports/$importId"
              params={{ importId: row.importId }}
              className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 p-3"
            >
              <span className="underline">{formatIsDate(row.createdAt)}</span>
              <span className="text-sm text-muted-fg">{STATE_WORD[row.state]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const loadImports = () => outcome(listImports(), 200);

export function ImportsScreen({ notice }: Readonly<{ notice?: PageNotice | undefined }>) {
  const [list, reload] = useLoad(loadImports);
  const working = list?.ok === true && list.data.imports.some((row) => row.state === "parsing");
  usePoll(working, reload);
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.imports_title}</h1>
      <p className="mt-2">{strings.imports_intro}</p>
      <FileSection />
      <ProfileSection />
      <PageSection notice={notice} />
      {list?.ok === false && (
        <Status>
          <ImportProblem problem={list.problem} />
        </Status>
      )}
      {list?.ok === true && <EarlierList imports={list.data.imports} />}
    </>
  );
}
