import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { notifications, readNotifications, type Notification } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { authorName } from "../social/post.tsx";
import { ProblemText, Status } from "../ui/kit.tsx";
import { unreadChanged } from "../ui/unread.tsx";

// What was addressed to this account (decision 0067), newest first. Opening
// the list marks what it shows read.
export const Route = createFileRoute("/notifications")({ component: Notifications });

function Notifications() {
  const [page] = useLoad(useCallback(() => outcome(notifications(), 200), []));
  const newest = page?.ok ? page.data.notifications[0]?.createdAt : undefined;
  useEffect(() => {
    if (newest === undefined) return;
    void outcome(readNotifications({ body: { upTo: newest } }), 204).then(unreadChanged);
  }, [newest]);

  return (
    <>
      <h1 className="font-headline text-3xl">{strings.tab_notifications}</h1>
      {page === null && <Status>{strings.loading}</Status>}
      {page?.ok === false && (
        <Status>
          <ProblemText problem={page.problem} />
        </Status>
      )}
      {page?.ok && page.data.notifications.length === 0 && (
        <p className="mt-4 text-muted-fg">{strings.notifications_empty}</p>
      )}
      {page?.ok && (
        <ul className="mt-4 flex flex-col gap-2">
          {page.data.notifications.map((n) => (
            <li key={n.notificationId}>
              <Item notification={n} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function text(n: Notification): string {
  const name = authorName(n.actor);
  return {
    comment: () => strings.notice_comment({ name }),
    reaction: () => strings.notice_reaction({ name }),
    join_approved: () => strings.notice_join_approved,
    moderated: () => strings.notice_moderated,
  }[n.kind]();
}

function Item({ notification: n }: Readonly<{ notification: Notification }>) {
  const body = (
    <>
      <span className={n.read ? "" : "font-semibold"}>{text(n)}</span>
      <time dateTime={new Date(n.createdAt).toISOString()} className="text-sm text-muted-fg">
        {when(n.createdAt)}
      </time>
    </>
  );
  const box = "flex min-h-11 flex-col justify-center rounded-md border border-border px-4 py-2";
  // A removed post is not there to open; its community is.
  if (n.postId !== null && n.kind !== "moderated") {
    return (
      <Link to="/posts/$postId" params={{ postId: n.postId }} className={box}>
        {body}
      </Link>
    );
  }
  return (
    <Link to="/communities/$communityId" params={{ communityId: n.communityId }} className={box}>
      {body}
    </Link>
  );
}
