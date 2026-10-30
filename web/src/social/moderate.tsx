import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import {
  communityModerationLog,
  deleteCommunity,
  setCommunityRole,
  updateCommunity,
  type Community,
  type CommunityMember,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "./avatar.tsx";
import { LogEntries } from "./moderation-log.tsx";
import { Waiting } from "./manage-frame.tsx";
import { useMembers } from "./members.ts";
import { CommunityPictures } from "./picture-pick.tsx";
import { outcome, useLoad } from "./outcome.ts";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { LAYOUTS } from "../ui/layout.ts";
import { useSizeClass } from "../ui/size-class.ts";

// Stjórna (decision 0079): what a community's owner and moderators reach
// for, on a page of its own (decision 0080) that the community's `⋯` menu opens. The reports and the join requests each with
// what waits for them, the details the owner changes (decision 0063), the
// members whose role the owner names, the actions kept (decision 0063), and
// the delete only the owner may do (decision 0070). On an expanded window
// (decision 0087) the side navigation of `ManageFrame` reaches the queues,
// the members and the log, each a page of its own, and this page keeps the
// details and the delete.

/** The moderator's and the owner's tools, with the number waiting for them. */
export function Manage({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const { communityId } = community;
  // The stylesheet leaves out what the side navigation reaches, so a server
  // render is right at every width; only the details' first state needs the size class.
  const sideNav = LAYOUTS[useSizeClass()].manage === "side-nav";
  const waiting =
    (community.openReports ?? 0) +
    (community.pendingJoinRequests ?? 0) +
    community.pendingAnonymous;
  const owner = community.role === "owner";
  return (
    <section aria-labelledby="manage-title" className="mt-4">
      {/* Beside the side navigation this page is `community_edit`, titled as each other part is. */}
      <h1 id="manage-title" className="font-headline text-3xl expanded:hidden">
        {waiting > 0
          ? strings.community_manage_count({ count: waiting })
          : strings.community_manage}
      </h1>
      <div className="mt-3 flex flex-col gap-4">
        <nav className="flex flex-wrap gap-x-6 expanded:hidden">
          <Link
            to="/communities/$communityId/reports"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {strings.moderation_queue}
            <Waiting count={community.openReports} />
          </Link>
          <Link
            to="/communities/$communityId/requests"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {community.pendingJoinRequests !== null && community.pendingJoinRequests > 0
              ? strings.join_requests_waiting({ count: community.pendingJoinRequests })
              : strings.join_requests_title}
          </Link>
          {(community.anonymousPosts || community.pendingAnonymous > 0) && (
            <Link
              to="/communities/$communityId/anonymous"
              params={{ communityId }}
              className="inline-flex min-h-11 items-center underline"
            >
              {community.pendingAnonymous > 0
                ? strings.anonymous_queue_waiting({ count: community.pendingAnonymous })
                : strings.anonymous_queue_title}
            </Link>
          )}
        </nav>
        <Edit community={community} changed={changed} owner={owner} open={sideNav} />
        {owner && (
          <div className="expanded:hidden">
            <Roles community={community} changed={changed} heading="section" />
          </div>
        )}
        <div className="expanded:hidden">
          <Log communityId={communityId} heading="section" />
        </div>
        {owner && <Delete community={community} />}
      </div>
    </section>
  );
}

/** `community_edit`: the owner changes its name, description or audience (decision 0063). */
function Edit({
  community,
  changed,
  owner,
  open,
}: Readonly<{ community: Community; changed: () => void; owner: boolean; open: boolean }>) {
  const id = useId();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [audience, setAudience] = useState<"open" | "private">(community.audience);
  const [anonymous, setAnonymous] = useState(community.anonymousPosts);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      updateCommunity({
        path: { communityId: community.communityId },
        body: {
          name: name.trim(),
          description: description.trim(),
          audience,
          anonymousPosts: anonymous,
        },
      }),
      200,
    );
    setBusy(false);
    if (done.ok) changed();
    else setProblem(done.problem);
  }

  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <details open={open}>
      <summary className="cursor-pointer text-base font-semibold expanded:hidden">
        {strings.community_edit}
      </summary>
      <h1 className="hidden font-headline text-3xl expanded:block">{strings.community_edit}</h1>
      <div className="mt-2">
        <CommunityPictures community={community} changed={changed} />
      </div>
      {owner && (
        <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-col gap-2">
          <label htmlFor={`${id}-name`}>{strings.community_name}</label>
          <input
            id={`${id}-name`}
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
          <label htmlFor={`${id}-description`}>{strings.community_description}</label>
          <textarea
            id={`${id}-description`}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={`${field} py-2`}
          />
          <fieldset className="flex flex-col">
            {(["open", "private"] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === value}
                  // A private community never becomes open: its members joined on that promise.
                  disabled={value === "open" && community.audience === "private"}
                  onChange={() => setAudience(value)}
                />
                <span className="font-semibold">
                  {value === "open" ? strings.community_open : strings.community_private}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            <span className="flex flex-col">
              <span className="font-semibold">{strings.community_anonymous_posts}</span>
              <span className="text-sm text-muted-fg">
                {strings.community_anonymous_posts_hint}
              </span>
            </span>
          </label>
          <Button tone="primary" type="submit" disabled={busy || name.trim() === ""}>
            {strings.community_edit}
          </Button>
          <Status>{problem && <ProblemText problem={problem} />}</Status>
        </form>
      )}
    </details>
  );
}

/** A part of Stjórna's title: the page's own, or a section's on the one screen. */
function Title({ heading, children }: Readonly<{ heading: Heading; children: string }>) {
  return heading === "page" ? (
    <h1 className="font-headline text-3xl">{children}</h1>
  ) : (
    <h3 className="font-semibold">{children}</h3>
  );
}

type Heading = "page" | "section";

/** The members whose role the owner names (decision 0063), and each one as it is. */
export function Roles({
  community,
  changed,
  heading,
}: Readonly<{ community: Community; changed: () => void; heading: Heading }>) {
  const [members, reload] = useMembers(community.communityId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function setRole(member: CommunityMember, role: "moderator" | "member") {
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      setCommunityRole({
        path: { communityId: community.communityId, accountId: member.accountId },
        body: { role },
      }),
      204,
    );
    setBusy(false);
    if (done.ok) {
      reload();
      changed();
    } else setProblem(done.problem);
  }

  return (
    <section aria-label={strings.community_members_title} className="flex flex-col gap-2">
      <Title heading={heading}>{strings.community_members_title}</Title>
      {members === null && <Status>{strings.loading}</Status>}
      {members?.ok === false && (
        <Status>
          <ProblemText problem={members.problem} />
        </Status>
      )}
      {members?.ok && (
        <ul className="flex flex-col gap-2">
          {members.data.members.map((member) => (
            <li key={member.accountId} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <Avatar
                  kind="person"
                  id={member.accountId}
                  name={member.name}
                  photo={member.photo}
                  className="size-8 rounded-md text-sm"
                />
                <span className="font-semibold">{member.name ?? strings.person_unnamed}</span>
                {member.verified && <VerifiedMark className="text-sm" />}
                {member.role === "moderator" && (
                  <span className="text-sm text-muted-fg">{strings.community_role_moderator}</span>
                )}
              </span>
              {member.role === "member" && (
                <Button disabled={busy} onClick={() => void setRole(member, "moderator")}>
                  {strings.community_make_moderator}
                </Button>
              )}
              {member.role === "moderator" && (
                <Button disabled={busy} onClick={() => void setRole(member, "member")}>
                  {strings.community_remove_moderator}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}

/** The log, newest first (decision 0063), kept a year (decision 0070). */
export function Log({ communityId, heading }: Readonly<{ communityId: string; heading: Heading }>) {
  const [log] = useLoad(
    useCallback(
      () => outcome(communityModerationLog({ path: { communityId } }), 200),
      [communityId],
    ),
  );
  return (
    <section aria-label={strings.moderation_log_title} className="flex flex-col gap-2">
      <Title heading={heading}>{strings.moderation_log_title}</Title>
      {log === null && <Status>{strings.loading}</Status>}
      {log?.ok === false && (
        <Status>
          <ProblemText problem={log.problem} />
        </Status>
      )}
      {log?.ok && log.data.entries.length === 0 && (
        <p className="text-muted-fg">{strings.moderation_log_empty}</p>
      )}
      {log?.ok && <LogEntries entries={log.data.entries} />}
    </section>
  );
}

/** The owner deletes the community, once they confirm what goes with it (#364). */
function Delete({ community }: Readonly<{ community: Community }>) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function remove() {
    if (!confirm(strings.community_delete_confirm({ name: community.name }))) return;
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      deleteCommunity({ path: { communityId: community.communityId } }),
      204,
    );
    setBusy(false);
    if (done.ok) await navigate({ to: "/communities" });
    else setProblem(done.problem);
  }
  return (
    <section className="flex flex-col items-start gap-2 border-t border-border pt-4">
      <Button tone="danger" disabled={busy} onClick={() => void remove()}>
        {strings.community_delete}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}
