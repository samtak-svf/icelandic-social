import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Community, Notification } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { noticeText } from "../lib/notice-text.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { Avatar } from "./avatar.tsx";
import { NoticeBadgeMark } from "./notice-badge.tsx";

// One row of the notification list (decisions 0103 to 0106): the newest
// actors' pictures with the mark of what they did, the community, the
// sentence, the quoted text and the age. Unread rows are tinted and dotted.

export interface NoticeActions {
  open: (n: Notification) => void;
  setRead: (n: Notification, read: boolean) => void;
  remove: (n: Notification) => void;
  kindInApp: (n: Notification) => void;
  communityOff: (n: Notification) => void;
}

function Pictures({
  n,
  community,
}: Readonly<{ n: Notification; community: Community | undefined }>) {
  const [first, second] = n.actors;
  if (first === undefined) {
    return (
      <Avatar
        kind="community"
        id={n.communityId ?? n.notificationId}
        name={community?.name ?? null}
        photo={community?.photo ?? null}
        className="size-10 rounded-lg"
      />
    );
  }
  const one = (a: NonNullable<typeof first>, className: string) => (
    <Avatar
      kind="person"
      id={a.accountId}
      name={a.name}
      photo={a.photo}
      className={`${className} rounded-md`}
    />
  );
  if (n.actorCount < 2 || second === undefined) return one(first, "size-10");
  return (
    <span className="relative block size-10">
      <span className="absolute right-0 top-0 rounded-md ring-2 ring-surface">
        {one(second, "size-7")}
      </span>
      <span className="absolute bottom-0 left-0 rounded-md ring-2 ring-surface">
        {one(first, "size-7")}
      </span>
    </span>
  );
}

/** The moderated rows a statement of reasons explains (decision 0115). */
const STATED: ReadonlySet<string | null> = new Set([
  "hide_post",
  "remove_post",
  "hide_comment",
  "remove_comment",
  "clear_account_photo",
  "suspend_account",
  "review_upheld",
  "review_overturned",
]);

const LINK = "flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2";

/** Where a row leads: what it tells of, or nowhere when that is not there to open. */
function NoticeLink({
  n,
  onClick,
  children,
}: Readonly<{ n: Notification; onClick: () => void; children: ReactNode }>) {
  const common = { className: LINK, onClick, children };
  if (n.kind === "reports_waiting") return <Link to="/moderation" {...common} />;
  // What a moderator did is read with its reasons; a removed post is not there to open.
  if (n.kind === "moderated" && STATED.has(n.action)) return <Link to="/statements" {...common} />;
  if ((n.kind === "friend_request" || n.kind === "friend_accepted") && n.actor) {
    return <Link to="/people/$accountId" params={{ accountId: n.actor.accountId }} {...common} />;
  }
  if (n.postId !== null && n.kind !== "moderated") {
    return <Link to="/posts/$postId" params={{ postId: n.postId }} {...common} />;
  }
  if (n.communityId !== null) {
    return (
      <Link to="/communities/$communityId" params={{ communityId: n.communityId }} {...common} />
    );
  }
  return <button type="button" {...common} className={`${LINK} text-left`} />;
}

export function NoticeRow({
  notification: n,
  community,
  actions,
}: Readonly<{
  notification: Notification;
  community: Community | undefined;
  actions: NoticeActions;
}>) {
  const said = noticeText(n);
  const body = (
    <>
      <span className="relative shrink-0">
        <Pictures n={n} community={community} />
        <NoticeBadgeMark badge={said.badge} emoji={n.emoji || null} />
      </span>
      <span className="flex min-w-0 flex-col">
        {community !== undefined && (
          <span className="truncate text-xs text-muted-fg">{community.name}</span>
        )}
        <span className={n.read ? "" : "font-semibold"}>{said.text}</span>
        {n.snippet !== null && (
          <span className="truncate text-sm text-muted-fg">
            {strings.notice_snippet({ text: n.snippet })}
          </span>
        )}
        <time dateTime={new Date(n.createdAt).toISOString()} className="text-sm text-muted-fg">
          {relativeTime(n.createdAt)}
        </time>
      </span>
      {!n.read && (
        <span aria-hidden="true" className="ml-auto size-2 shrink-0 rounded-full bg-primary" />
      )}
    </>
  );
  const onClick = () => actions.open(n);
  return (
    <div
      className={`flex items-center rounded-md border border-border ${n.read ? "" : "bg-muted"}`}
    >
      <NoticeLink n={n} onClick={onClick}>
        {body}
      </NoticeLink>
      <Menu label={strings.notice_menu} icon={<DotsIcon />}>
        {(close) => {
          const run = (act: () => void) => () => {
            close();
            act();
          };
          return (
            <>
              <MenuItem onSelect={run(() => actions.setRead(n, !n.read))}>
                {n.read ? strings.notice_menu_unread : strings.notice_menu_read}
              </MenuItem>
              <MenuItem onSelect={run(() => actions.remove(n))}>
                {strings.notice_menu_remove}
              </MenuItem>
              {n.kind !== "moderated" && n.kind !== "reports_waiting" && (
                <>
                  <MenuItem onSelect={run(() => actions.kindInApp(n))}>
                    {strings.notice_menu_kind_in_app}
                  </MenuItem>
                  {n.communityId !== null && (
                    <MenuItem onSelect={run(() => actions.communityOff(n))}>
                      {strings.notice_menu_community_off}
                    </MenuItem>
                  )}
                </>
              )}
            </>
          );
        }}
      </Menu>
    </div>
  );
}
