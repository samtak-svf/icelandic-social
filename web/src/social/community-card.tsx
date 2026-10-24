import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Problem } from "../problem.ts";
import { pinCommunity, unpinCommunity, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { ProblemText, Status } from "../ui/kit.tsx";
import { Avatar } from "./avatar.tsx";
import { outcome } from "./outcome.ts";

// The rows of the communities hub (decisions 0079, 0080), shared by its tabs
// and by the column beside the feed on an expanded window (decision 0087).

/** The rows of `communities`, in the order given. */
export function CommunityList({
  communities,
  changed,
}: Readonly<{ communities: Community[]; changed?: () => void }>) {
  if (communities.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {communities.map((c) => (
        <li key={c.communityId}>
          <CommunityCard community={c} changed={changed} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One community among the person's or on its way to discovery (decisions 0079
 * and 0080): its picture and name, in bold with a count and a dot while it has
 * posts the person has not seen, otherwise when it was last posted in. A
 * member can pin it to the top of their list from the row's `⋯`.
 */
function CommunityCard({
  community,
  changed,
}: Readonly<{ community: Community; changed?: () => void }>) {
  const unread = community.unread > 0;
  const [problem, setProblem] = useState<Problem | null>(null);
  async function togglePin() {
    setProblem(null);
    const path = { communityId: community.communityId };
    const done = await outcome(
      community.pinned ? unpinCommunity({ path }) : pinCommunity({ path }),
      204,
    );
    if (done.ok) changed?.();
    else setProblem(done.problem);
  }
  return (
    <div className="flex min-h-14 items-center gap-1 rounded-md border border-border pr-1">
      <Link
        to="/communities/$communityId"
        params={{ communityId: community.communityId }}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2"
      >
        <Avatar
          kind="community"
          id={community.communityId}
          name={community.name}
          photo={community.photo}
          className="size-10 rounded-lg"
        />
        <span className="flex min-w-0 flex-col justify-center">
          <span className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>
            {community.name}
          </span>
          <span className="text-sm text-muted-fg">
            {unread ? (
              <span className="inline-flex items-center gap-1 font-medium text-fg">
                {strings.community_new_posts({ count: community.unread })}
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              </span>
            ) : community.lastPostAt !== null ? (
              strings.community_last_post({ when: relativeTime(community.lastPostAt) })
            ) : community.audience === "open" ? (
              strings.community_open
            ) : (
              strings.community_private
            )}
            {community.memberCount !== null &&
              ` · ${strings.community_members({ count: community.memberCount })}`}
          </span>
        </span>
      </Link>
      {community.role !== null && changed !== undefined && (
        <Menu label={strings.more_options} icon={<DotsIcon />} align="right">
          {(close) => (
            <MenuItem
              onSelect={() => {
                close();
                void togglePin();
              }}
            >
              {community.pinned ? strings.community_unpin : strings.community_pin}
            </MenuItem>
          )}
        </Menu>
      )}
      {problem && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
    </div>
  );
}

/** The first row of a verified person's list: the way to create a community. */
export function CreateRow() {
  return (
    <Link
      to="/communities/new"
      className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 py-2"
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-2xl"
      >
        +
      </span>
      <span className="flex min-w-0 flex-col justify-center">
        <span className="font-semibold">{strings.community_create}</span>
        <span className="text-sm text-muted-fg">{strings.communities_create_row_hint}</span>
      </span>
    </Link>
  );
}
