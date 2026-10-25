import { Link } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { getCommunity, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { outcome, useLoad } from "./outcome.ts";

// Stjórna's frame (decisions 0079, 0080, 0087): the way back to the community
// and, on an expanded window, a side navigation to each part of Stjórna, kept
// in place from page to page, with what waits on each. On a compact or medium
// window there is no side navigation: Stjórna is the one screen, and the
// queues are reached from it.

/** The pages of Stjórna, the community loaded once for the page and its navigation. */
export function ManageFrame({
  communityId,
  children,
}: Readonly<{
  communityId: string;
  children: (community: Community, changed: () => void) => ReactNode;
}>) {
  const [community, reload] = useLoad(
    useCallback(() => outcome(getCommunity({ path: { communityId } }), 200), [communityId]),
  );
  const manages =
    community?.ok === true &&
    (community.data.role === "owner" || community.data.role === "moderator");
  return (
    <div className="expanded:grid expanded:grid-cols-[14rem_minmax(0,42rem)] expanded:items-start expanded:justify-center expanded:gap-8">
      {manages ? <ManageNav community={community.data} /> : <div />}
      <div className="min-w-0">
        <Link
          to="/communities/$communityId"
          params={{ communityId }}
          className="inline-flex min-h-11 items-center underline"
        >
          {strings.post_back}
        </Link>
        {community === null && <Status>{strings.loading}</Status>}
        {community?.ok === false && (
          <Status>
            <ProblemText problem={community.problem} />
          </Status>
        )}
        {community?.ok && children(community.data, reload)}
      </div>
    </div>
  );
}

/** What waits on a part of Stjórna, shown when anything does. */
export function Waiting({ count }: Readonly<{ count: number | null }>) {
  if (count === null || count === 0) return null;
  return <span className="ml-2 rounded-full bg-primary px-2 text-sm text-primary-fg">{count}</span>;
}

function ManageNav({ community }: Readonly<{ community: Community }>) {
  const { communityId } = community;
  const item = "flex min-h-11 items-center rounded-md px-3";
  const active = { className: "bg-muted font-semibold" };
  return (
    <nav
      aria-label={strings.community_manage}
      className="hidden flex-col gap-1 rounded-md border border-border p-2 expanded:sticky expanded:top-6 expanded:flex"
    >
      <p className="px-3 py-2 font-headline text-xl [overflow-wrap:anywhere]">{community.name}</p>
      <Link
        to="/communities/$communityId/manage"
        params={{ communityId }}
        className={item}
        activeProps={active}
      >
        {strings.community_edit}
      </Link>
      <Link
        to="/communities/$communityId/requests"
        params={{ communityId }}
        className={item}
        activeProps={active}
      >
        {strings.join_requests_title}
        <Waiting count={community.pendingJoinRequests} />
      </Link>
      {/* Shown while the community takes anonymous posts, or while any still waits (0091). */}
      {(community.anonymousPosts || community.pendingAnonymous > 0) && (
        <Link
          to="/communities/$communityId/anonymous"
          params={{ communityId }}
          className={item}
          activeProps={active}
        >
          {strings.anonymous_queue_title}
          <Waiting count={community.pendingAnonymous} />
        </Link>
      )}
      <Link
        to="/communities/$communityId/reports"
        params={{ communityId }}
        className={item}
        activeProps={active}
      >
        {strings.moderation_queue}
        <Waiting count={community.openReports} />
      </Link>
      {/* Naming moderators is the owner's (decision 0063). */}
      {community.role === "owner" && (
        <Link
          to="/communities/$communityId/members"
          params={{ communityId }}
          className={item}
          activeProps={active}
        >
          {strings.community_members_title}
        </Link>
      )}
      <Link
        to="/communities/$communityId/log"
        params={{ communityId }}
        className={item}
        activeProps={active}
      >
        {strings.moderation_log_title}
      </Link>
    </nav>
  );
}
