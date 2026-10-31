import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  listFriendRequests,
  listFriends,
  listSnoozes,
  unsnoozePerson,
  type FriendPage,
  type FriendRequest,
  type SnoozeList,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { FriendRow } from "../social/friend-row.tsx";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { SuggestedPeople } from "../social/suggestions.tsx";
import { useAct } from "../social/use-act.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// The account's own lists (decision 0114): the requests to it and from it, its
// friends, and whom it has snoozed. Nobody else's list exists anywhere.
export const Route = createFileRoute("/friends")({ component: Friends });

type Sort = "newest" | "name";
type Actions = ReturnType<typeof useAct>;

const pathOf = (person: { accountId: string }) => ({ path: { accountId: person.accountId } });

function Friends() {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const [requests, reloadRequests] = useLoad(
    useCallback(() => outcome(listFriendRequests(), 200), []),
  );
  const [page, reloadFriends] = useLoad(
    useCallback(
      () => outcome(listFriends({ query: { sort, ...(query === "" ? {} : { q: query }) } }), 200),
      [query, sort],
    ),
  );
  const [snoozes, reloadSnoozes] = useLoad(useCallback(() => outcome(listSnoozes(), 200), []));
  const actions = useAct(() => {
    reloadRequests();
    reloadFriends();
    reloadSnoozes();
  });
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.person_friends}</h1>
      {actions.problem !== null && (
        <Status>
          <ProblemText problem={actions.problem} />
        </Status>
      )}
      {requests?.ok && <Incoming requests={requests.data.incoming} actions={actions} />}
      <section className="mt-4 flex flex-col gap-2">
        {page?.ok && (
          <p className="text-muted-fg">{strings.person_friend_count({ count: page.data.count })}</p>
        )}
        <Controls typed={typed} setTyped={setTyped} sort={sort} setSort={setSort} />
        <List page={page} searched={query !== ""} />
      </section>
      {requests?.ok && <Sent requests={requests.data.sent} actions={actions} />}
      <SuggestedPeople actions={actions} />
      {snoozes?.ok && <Snoozed snoozed={snoozes.data.snoozed} actions={actions} />}
    </>
  );
}

function Listed({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="mt-6 flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

function Incoming({
  requests,
  actions: { busy, act },
}: Readonly<{
  requests: readonly FriendRequest[];
  actions: Actions;
}>) {
  if (requests.length === 0) return null;
  return (
    <Listed title={strings.friends_incoming}>
      {requests.map(({ person }) => (
        <FriendRow key={person.accountId} person={person}>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() => act(() => outcome(acceptFriendRequest(pathOf(person)), 204))}
          >
            {strings.person_accept}
          </Button>
          <Button
            disabled={busy}
            onClick={() => act(() => outcome(declineFriendRequest(pathOf(person)), 204))}
          >
            {strings.person_decline}
          </Button>
        </FriendRow>
      ))}
    </Listed>
  );
}

function Sent({
  requests,
  actions: { busy, act },
}: Readonly<{
  requests: readonly FriendRequest[];
  actions: Actions;
}>) {
  if (requests.length === 0) return null;
  return (
    <Listed title={strings.friends_sent}>
      {requests.map(({ person }) => (
        <FriendRow key={person.accountId} person={person}>
          <Button
            disabled={busy}
            onClick={() => act(() => outcome(cancelFriendRequest(pathOf(person)), 204))}
          >
            {strings.person_cancel_request}
          </Button>
        </FriendRow>
      ))}
    </Listed>
  );
}

function Snoozed({
  snoozed,
  actions: { busy, act },
}: Readonly<{
  snoozed: SnoozeList["snoozed"];
  actions: Actions;
}>) {
  if (snoozed.length === 0) return null;
  return (
    <Listed title={strings.friends_snoozed}>
      {snoozed.map(({ person, until }) => (
        <FriendRow
          key={person.accountId}
          person={person}
          detail={strings.person_snoozed_until({ date: formatIsDate(until) })}
        >
          <Button
            disabled={busy}
            onClick={() => act(() => outcome(unsnoozePerson(pathOf(person)), 204))}
          >
            {strings.person_unsnooze}
          </Button>
        </FriendRow>
      ))}
    </Listed>
  );
}

function Controls({
  typed,
  setTyped,
  sort,
  setSort,
}: Readonly<{
  typed: string;
  setTyped: (text: string) => void;
  sort: Sort;
  setSort: (sort: Sort) => void;
}>) {
  const searchId = useId();
  const sortId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={searchId} className="sr-only">
        {strings.people_search}
      </label>
      <input
        id={searchId}
        type="search"
        placeholder={strings.people_search}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3"
      />
      <label htmlFor={sortId} className="sr-only">
        {strings.friends_sort_label}
      </label>
      <select
        id={sortId}
        value={sort}
        onChange={(e) => setSort(e.target.value === "name" ? "name" : "newest")}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-2"
      >
        <option value="newest">{strings.friends_sort_newest}</option>
        <option value="name">{strings.friends_sort_name}</option>
      </select>
    </div>
  );
}

function List({
  page,
  searched,
}: Readonly<{
  page: Outcome<FriendPage> | null;
  searched: boolean;
}>) {
  if (page === null) return <Status>{strings.loading}</Status>;
  if (!page.ok) {
    return (
      <Status>
        <ProblemText problem={page.problem} />
      </Status>
    );
  }
  if (page.data.friends.length === 0) {
    return (
      <p className="text-muted-fg">
        {searched ? strings.friends_search_empty : strings.friends_empty}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {page.data.friends.map(({ person, since }) => (
        <FriendRow
          key={person.accountId}
          person={person}
          detail={strings.person_friends_since({ date: formatIsDate(since) })}
        />
      ))}
    </ul>
  );
}
