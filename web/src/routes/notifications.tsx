import { createFileRoute } from "@tanstack/react-router";
import { type ComponentProps, useCallback } from "react";
import { useChat } from "../chat/chat.tsx";
import { UnreadConversations } from "../chat/unread-conversations.tsx";
import { myCommunities } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { noticeSections } from "../lib/notice-sections.ts";
import { loadNotices, useNotices } from "../social/notice-actions.ts";
import { NoticeRow } from "../social/notice-row.tsx";
import { type Outcome, outcome, useLoad } from "../social/outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// What was addressed to this account (decisions 0067, 0103, 0104), newest
// first. Opening the list marks it seen, which clears its part of the badge; a row is
// read when it is opened or marked from its menu. Above them, who wrote to the
// conversations this browser has unread, never what (0124).
export const Route = createFileRoute("/notifications")({ component: Notifications });

function Notifications() {
  const [page] = useLoad(loadNotices);
  // The picture and name of the community a notice belongs to.
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const byId = new Map((mine?.ok ? mine.data.communities : []).map((c) => [c.communityId, c]));
  const loaded = page?.ok ? page.data : null;
  const { rows, actions, markAll } = useNotices(loaded);
  const { unread } = useChat();
  const sections = noticeSections(rows ?? [], loaded?.seenAt ?? null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-headline text-3xl">{strings.notifications_title}</h1>
        {rows !== null && rows.some((n) => !n.read) && (
          <Button onClick={markAll}>{strings.notifications_mark_all_read}</Button>
        )}
      </div>
      <LoadStatus page={page} />
      {rows?.length === 0 && unread.length === 0 && (
        <p className="mt-4 text-muted-fg">{strings.notifications_empty}</p>
      )}
      <UnreadConversations rows={unread} />
      <NoticeSection
        title={strings.notice_section_new}
        list={sections.fresh}
        byId={byId}
        actions={actions}
      />
      <NoticeSection
        title={strings.notice_section_earlier}
        list={sections.earlier}
        byId={byId}
        actions={actions}
      />
    </>
  );
}

function LoadStatus({ page }: { page: Outcome<unknown> | null }) {
  if (page === null) return <Status>{strings.loading}</Status>;
  if (page.ok) return null;
  return (
    <Status>
      <ProblemText problem={page.problem} />
    </Status>
  );
}

type RowProps = ComponentProps<typeof NoticeRow>;

function NoticeSection({
  title,
  list,
  byId,
  actions,
}: {
  title: string;
  list: readonly RowProps["notification"][];
  byId: ReadonlyMap<string, NonNullable<RowProps["community"]>>;
  actions: RowProps["actions"];
}) {
  if (list.length === 0) return null;
  return (
    <section aria-label={title} className="mt-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {list.map((n) => (
          <li key={n.notificationId}>
            <NoticeRow
              notification={n}
              community={n.communityId === null ? undefined : byId.get(n.communityId)}
              actions={actions}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
