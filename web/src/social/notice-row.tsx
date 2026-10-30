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
  const link = "flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2";
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
  // What a moderator did is read with its reasons; a removed post is not there to open.
  const toStatements = n.kind === "moderated" && STATED.has(n.action);
  const toPost = n.postId !== null && n.kind !== "moderated";
  const onClick = () => actions.open(n);
  return (
    <div
      className={`flex items-center rounded-md border border-border ${n.read ? "" : "bg-muted"}`}
    >
      {toStatements ? (
        <Link to="/statements" className={link} onClick={onClick}>
          {body}
        </Link>
      ) : toPost ? (
        <Link to="/posts/$postId" params={{ postId: n.postId! }} className={link} onClick={onClick}>
          {body}
        </Link>
      ) : n.communityId !== null ? (
        <Link
          to="/communities/$communityId"
          params={{ communityId: n.communityId }}
          className={link}
          onClick={onClick}
        >
          {body}
        </Link>
      ) : (
        <button type="button" className={`${link} text-left`} onClick={onClick}>
          {body}
        </button>
      )}
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
              {n.kind !== "moderated" && (
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
