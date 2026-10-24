import { Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useState } from "react";
import type { Problem } from "../problem.ts";
import {
  getCommunity,
  joinCommunity,
  restoreCommunity,
  withdrawJoinRequest,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { CommunityAside } from "./community-aside.tsx";
import { CommunityBar, CommunityHeader } from "./community-header.tsx";
import { CommunityTabs, tabOf } from "./community-tabs.tsx";
import { useMembers, type Members } from "./members.ts";
import { outcome, useLoad, type Outcome } from "./outcome.ts";

// What every tab of a community shares (decisions 0063, 0080, 0089): the bar,
// the header, joining and withdrawing a join request, the row of tabs and,
// on an expanded window, the aside beside the tab. The community and its
// members are loaded once here; a tab reads them from `useCommunityTab`. A
// platform moderator alone sees a deleted one, and restores it within its 30
// days (decision 0070).

type Shared = { community: Community; members: Members | undefined; changed: () => void };

const Tab = createContext<Shared | null>(null);

/** The community the tab belongs to, its members (undefined where the reader may not see them) and the reload. */
export function useCommunityTab(): Shared {
  const shared = useContext(Tab);
  if (shared === null) throw new Error("useCommunityTab outside a community");
  return shared;
}

export function CommunityFrame({ communityId }: Readonly<{ communityId: string }>) {
  const [community, reload] = useLoad(
    useCallback(() => outcome(getCommunity({ path: { communityId } }), 200), [communityId]),
  );
  if (community === null) return <Status>{strings.loading}</Status>;
  if (!community.ok) {
    return (
      <Status>
        <ProblemText problem={community.problem} />
      </Status>
    );
  }
  const c = community.data;
  if (c.deletedAt !== null) return <Deleted community={c} restored={reload} />;
  const reads = c.role !== null || c.audience === "open";
  return reads ? (
    <Readable community={c} changed={reload} />
  ) : (
    <Columns community={c} changed={reload} />
  );
}

/** A community the reader may read: its members are loaded once, for the header, the aside and Meðlimir. */
function Readable({ community, changed }: Readonly<{ community: Community; changed: () => void }>) {
  const [members] = useMembers(community.communityId);
  return <Columns community={community} changed={changed} members={members} />;
}

/** The tab, and beside it on an expanded window the aside. */
function Columns({
  community,
  changed,
  members,
}: Readonly<{ community: Community; changed: () => void; members?: Members }>) {
  const { communityId } = community;
  const readable = members !== undefined;
  const active = tabOf(useLocation({ select: (l) => l.pathname }));
  const searching = useSearch({ strict: false, select: (s) => s.search === true });
  const navigate = useNavigate();
  return (
    <div className="expanded:grid expanded:grid-cols-[minmax(0,1fr)_18rem] expanded:items-start expanded:gap-8">
      <div className="min-w-0">
        <CommunityBar community={community} changed={changed} />
        <CommunityHeader community={community} members={members} />
        <Membership community={community} changed={changed} />
        <CommunityTabs
          communityId={communityId}
          active={active}
          readable={readable}
          hasFeatured={community.featured.length > 0}
          searching={searching && active === "discussion"}
          onSearch={() =>
            void navigate({
              to: "/communities/$communityId",
              params: { communityId },
              search: searching && active === "discussion" ? {} : { search: true },
              replace: active === "discussion",
            })
          }
        />
        <div className="mt-4">
          {(readable || active === "about") && (
            <Tab.Provider value={{ community, members, changed }}>
              <Outlet />
            </Tab.Provider>
          )}
        </div>
      </div>
      <CommunityAside community={community} members={members} />
    </div>
  );
}

function Membership({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const path = { communityId: community.communityId };

  async function change(pending: Promise<Outcome<unknown>>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) changed();
    else if (done.problem) setProblem(done.problem);
  }

  const declinedUntil = community.joinDeclinedUntil;
  let control = null;
  if (declinedUntil !== null && declinedUntil > Date.now()) {
    control = (
      <>
        <p>{strings.community_join_declined}</p>
        <p className="text-sm text-muted-fg">
          {strings.community_join_again({ date: formatIsDate(declinedUntil) })}
        </p>
      </>
    );
  } else if (community.joinRequested) {
    control = (
      <>
        <p>{strings.community_join_requested}</p>
        <Button
          disabled={busy}
          onClick={() => void change(outcome(withdrawJoinRequest({ path }), 204))}
        >
          {strings.community_withdraw_request}
        </Button>
      </>
    );
  } else if (community.role === null) {
    const label =
      community.audience === "open" ? strings.community_join : strings.community_request_join;
    control = (
      <Button
        tone="primary"
        disabled={busy}
        onClick={() => void change(outcome(joinCommunity({ path }), 200))}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      {control}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}

const RESTORABLE_MS = 30 * 24 * 60 * 60 * 1000;

/** What a platform moderator sees of a deleted community: when it goes, and the way back. */
function Deleted({
  community,
  restored,
}: Readonly<{ community: Community; restored: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const deletedAt = community.deletedAt ?? 0;
  async function restore() {
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      restoreCommunity({ path: { communityId: community.communityId } }),
      200,
    );
    setBusy(false);
    if (done.ok) restored();
    else setProblem(done.problem);
  }
  return (
    <>
      <h1 className="font-headline text-3xl">{community.name}</h1>
      <p className="mt-2">
        {strings.community_deleted_notice({ date: formatIsDate(deletedAt + RESTORABLE_MS) })}
      </p>
      <div className="mt-4 flex flex-col items-start gap-2">
        <Button tone="primary" disabled={busy} onClick={() => void restore()}>
          {strings.community_restore}
        </Button>
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      </div>
    </>
  );
}
