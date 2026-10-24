import { useCallback, useEffect, useState } from "react";
import type { Problem } from "../problem.ts";
import { inviteToCommunity, listPeople, type Community, type Profile } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "./avatar.tsx";
import { outcome, useLoad } from "./outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { Dialog } from "../ui/dialog.tsx";

// Bjóða (decision 0080). A private community invites a person by name, through
// the invitation the API already has; an open one has nothing to ask of the
// invited, so it hands out the community's own link, shared where the device
// can share and copied where it cannot.

/** The address a person who opens it lands on this community's page. */
function communityLink(communityId: string): string {
  return `${location.origin}/communities/${communityId}`;
}

/** Shares or copies the link; what to tell the person, or the problem. */
async function shareLink(url: string, title: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ url, title });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (error) {
    // A person who closes the share sheet has not failed anything.
    return error instanceof DOMException && error.name === "AbortError" ? "shared" : "failed";
  }
}

export function Invite({ community }: Readonly<{ community: Community }>) {
  const [open, setOpen] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  async function link() {
    const done = await shareLink(communityLink(community.communityId), community.name);
    setTold(done === "copied" ? strings.community_link_copied : null);
  }
  // One box, so a row that spreads its children puts the button at its end;
  // the status hangs below it, so the button centres on the row.
  return (
    <div className="relative ms-auto">
      <Button
        tone="primary"
        onClick={() => (community.audience === "private" ? setOpen(true) : void link())}
      >
        {strings.invite}
      </Button>
      <div className="absolute end-0 top-full whitespace-nowrap">
        <Status>{told}</Status>
      </div>
      {open && <InviteDialog community={community} onClose={() => setOpen(false)} />}
    </div>
  );
}

function InviteDialog({
  community,
  onClose,
}: Readonly<{ community: Community; onClose: () => void }>) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const [people] = useLoad(
    useCallback(
      () => outcome(listPeople({ query: searched === "" ? {} : { q: searched } }), 200),
      [searched],
    ),
  );
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);

  async function invite(person: Profile) {
    setProblem(null);
    const done = await outcome(
      inviteToCommunity({
        path: { communityId: community.communityId, accountId: person.accountId },
      }),
      204,
    );
    if (done.ok) setSent(new Set([...sent, person.accountId]));
    else if (done.problem) setProblem(done.problem);
  }

  return (
    <Dialog title={strings.community_invite_title} onClose={onClose}>
      <label className="sr-only" htmlFor="invite-search">
        {strings.people_search}
      </label>
      <input
        id="invite-search"
        type="search"
        placeholder={strings.people_search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
      />
      <Status>
        {problem ? (
          <ProblemText problem={problem} />
        ) : (
          sent.size > 0 && strings.community_invite_sent
        )}
      </Status>
      {people === null && <Status>{strings.loading}</Status>}
      {people?.ok === false && (
        <Status>
          <ProblemText problem={people.problem} />
        </Status>
      )}
      {people?.ok && people.data.people.length === 0 && (
        <p className="text-muted-fg">{strings.community_invite_none}</p>
      )}
      {people?.ok && (
        <ul className="mt-2 flex max-h-80 flex-col gap-1 overflow-y-auto">
          {people.data.people.map((person) => (
            <li key={person.accountId} className="flex items-center gap-3">
              <Avatar
                kind="person"
                id={person.accountId}
                name={person.name}
                photo={person.photo}
                className="size-9 rounded-md text-sm"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {person.name ?? strings.person_unnamed}
              </span>
              <Button disabled={sent.has(person.accountId)} onClick={() => void invite(person)}>
                {strings.invite}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
