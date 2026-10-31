import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Problem } from "../problem.ts";
import { leaveCommunity, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar, Cover } from "./avatar.tsx";
import { Invite } from "./invite.tsx";
import type { Members } from "./members.ts";
import { outcome } from "./outcome.ts";
import { moderatesAs } from "./roles.tsx";
import { LAYOUTS } from "../ui/layout.ts";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { ProblemText, Status } from "../ui/kit.tsx";

// The community's top bar and header (decision 0080): back and the `⋯` menu
// in the bar; under it the cover, the picture, the large name, the audience
// line that opens Um, and the members' pictures with Bjóða. On an expanded
// window the description and the pictures move to the aside beside the feed
// (decision 0087), so the header leaves them out there.

/** Back to the hub, and the menu: Stjórna for moderators, Um, and leaving. */
export function CommunityBar({
  community,
  changed,
}: Readonly<{ community: Community; changed?: () => void }>) {
  const { communityId } = community;
  const navigate = useNavigate();
  const moderates = moderatesAs(community.role);
  const waiting =
    (community.openReports ?? 0) +
    (community.pendingJoinRequests ?? 0) +
    community.pendingAnonymous;
  const [problem, setProblem] = useState<Problem | null>(null);

  async function leave() {
    const done = await outcome(leaveCommunity({ path: { communityId } }), 204);
    if (done.ok) {
      changed?.();
      await navigate({ to: "/communities" });
    } else if (done.problem) setProblem(done.problem);
  }

  return (
    <div className="flex items-center justify-between">
      <Link
        to="/communities"
        className="inline-flex min-h-11 items-center gap-1 rounded-md pr-3 underline"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {strings.back}
      </Link>
      <Menu label={strings.more_options} icon={<DotsIcon />}>
        {(close) => (
          <>
            {moderates && (
              <Link
                to="/communities/$communityId/manage"
                params={{ communityId }}
                role="menuitem"
                onClick={close}
                className="flex min-h-11 items-center px-4 hover:bg-muted"
              >
                {waiting > 0
                  ? strings.community_manage_count({ count: waiting })
                  : strings.community_manage}
              </Link>
            )}
            <Link
              to="/communities/$communityId/about"
              params={{ communityId }}
              role="menuitem"
              onClick={close}
              className="flex min-h-11 items-center px-4 hover:bg-muted"
            >
              {strings.community_info}
            </Link>
            {community.role !== null && community.role !== "owner" && (
              <MenuItem
                tone="danger"
                onSelect={() => {
                  close();
                  void leave();
                }}
              >
                {strings.community_leave}
              </MenuItem>
            )}
          </>
        )}
      </Menu>
      {problem && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
    </div>
  );
}

/** The lock that marks a closed community. */
function Lock() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Pictures held in the browser that the create preview shows in place of fetched ones. */
export type PreviewImages = { photo: string | null; cover: string | null };

/**
 * The header; `members` is left out when the reader may not see them. With
 * `preview` (decision 0087) it is a picture of a community not yet made: the
 * given pictures, the description in place, and no links, since there is no
 * page for them to open.
 */
export function CommunityHeader({
  community,
  members,
  preview,
}: Readonly<{ community: Community; members?: Members; preview?: PreviewImages }>) {
  const { communityId } = community;
  const closed = community.audience === "private";
  const Title = preview === undefined ? "h1" : "h2";
  const audience = (
    <>
      {closed && <Lock />}
      {closed ? strings.community_private_full : strings.community_open_full}
      {community.memberCount !== null &&
        ` · ${strings.community_members({ count: community.memberCount })}`}
    </>
  );
  return (
    <header className="flex flex-col gap-3">
      <Cover
        communityId={communityId}
        version={community.cover}
        className="rounded-card"
        local={preview?.cover}
      />
      <div className="flex items-end gap-3">
        <Avatar
          kind="community"
          id={communityId}
          name={community.name}
          photo={community.photo}
          className="size-20 rounded-pill text-2xl"
          local={preview?.photo}
        />
        <div className="flex min-w-0 flex-col">
          <Title className="font-headline text-3xl [overflow-wrap:anywhere]">
            {community.name}
          </Title>
          {preview === undefined ? (
            <Link
              to="/communities/$communityId/about"
              params={{ communityId }}
              className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted-fg"
            >
              {audience}
            </Link>
          ) : (
            <p className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-fg">
              {audience}
            </p>
          )}
        </div>
      </div>
      {community.description !== "" && (
        <p
          className={`line-clamp-3 whitespace-pre-wrap ${preview === undefined ? "expanded:hidden" : ""}`}
        >
          {community.description}
        </p>
      )}
      {preview === undefined && (
        <div className="flex items-center justify-between gap-3">
          {members === undefined ? <span /> : <MemberStack members={members} />}
          {(community.role !== null || !closed) && <Invite community={community} />}
        </div>
      )}
    </header>
  );
}

/**
 * The first members' pictures, overlapped: five on a compact window, up to
 * twelve on a medium one, none on an expanded one, where the aside has them.
 * Decorative; the count is in the audience line.
 */
function MemberStack({ members }: Readonly<{ members: Members }>) {
  if (!members?.ok) return <span />;
  return (
    <ul aria-label={strings.community_members_stack} className="flex -space-x-2 expanded:hidden">
      {members.data.members.slice(0, LAYOUTS.medium.memberPictures).map((member, i) => (
        <li
          key={member.accountId}
          className={i < LAYOUTS.compact.memberPictures ? undefined : "hidden medium:block"}
        >
          <Avatar
            kind="person"
            id={member.accountId}
            name={member.name}
            photo={member.photo}
            className="size-9 rounded-full border-2 border-bg text-xs"
          />
        </li>
      ))}
    </ul>
  );
}
