import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { myCommunities, notifications } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { noticeSections } from "../lib/notice-sections.ts";
import { useNotices } from "../social/notice-actions.ts";
import { NoticeRow } from "../social/notice-row.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// What was addressed to this account (decisions 0067, 0103, 0104), newest
// first. Opening the list marks it seen, which clears the badge; a row is
// read when it is opened or marked from its menu.
export const Route = createFileRoute("/notifications")({ component: Notifications });

function Notifications() {
  const [page] = useLoad(useCallback(() => outcome(notifications(), 200), []));
  // The picture and name of the community a notice belongs to.
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const byId = new Map((mine?.ok ? mine.data.communities : []).map((c) => [c.communityId, c]));
  const { rows, actions, markAll } = useNotices(page?.ok ? page.data : null);
  const sections = noticeSections(rows ?? [], page?.ok ? page.data.seenAt : null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-headline text-3xl">{strings.tab_notifications}</h1>
        {rows !== null && rows.some((n) => !n.read) && (
          <Button onClick={markAll}>{strings.notifications_mark_all_read}</Button>
        )}
      </div>
      {page === null && <Status>{strings.loading}</Status>}
      {page?.ok === false && (
        <Status>
          <ProblemText problem={page.problem} />
        </Status>
      )}
      {rows?.length === 0 && <p className="mt-4 text-muted-fg">{strings.notifications_empty}</p>}
      {(
        [
          [strings.notice_section_new, sections.fresh],
          [strings.notice_section_earlier, sections.earlier],
        ] as const
      ).map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title} aria-label={title} className="mt-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {list.map((n) => (
                  <li key={n.notificationId}>
                    <NoticeRow
                      notification={n}
                      community={byId.get(n.communityId)}
                      actions={actions}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </>
  );
}
