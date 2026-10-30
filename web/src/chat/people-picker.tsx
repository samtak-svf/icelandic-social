import { useCallback, useEffect, useState } from "react";
import { listPeople, type Profile } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { Avatar } from "../social/avatar.tsx";
import { outcome } from "../social/outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import type { GroupProblem } from "./group-change.ts";

// The people picker of "add people" (decision 0078): the directory, searched
// by name and paged, with a checkbox each. Whoever is in the group already is
// shown taken and cannot be picked again, as on the apps. The page below holds
// what is picked; the list itself holds nothing, so it can be drawn from props.

const PAGE = 30;

/** The list, the search and the two buttons, drawn from what the picker holds. */
export function PeopleChoice({
  people,
  problem,
  searching,
  query,
  setQuery,
  taken,
  picked,
  toggle,
  more,
  confirm,
  cancel,
  busy,
  failed,
}: Readonly<{
  /** Null until the first page has come. */
  people: Profile[] | null;
  problem: Problem | null;
  /** Whether a name is being searched for, which the empty sentence follows. */
  searching: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** The accounts in the group already. */
  taken: ReadonlySet<string>;
  picked: ReadonlySet<string>;
  toggle: (account: string) => void;
  /** Null on the last page. */
  more: (() => void) | null;
  confirm: () => void;
  cancel: () => void;
  busy: boolean;
  failed: GroupProblem | null;
}>) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-headline text-2xl">{strings.add_people_title}</h1>
      <label className="sr-only" htmlFor="people-search">
        {strings.people_search}
      </label>
      <input
        id="people-search"
        type="search"
        placeholder={strings.people_search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
      />
      {people === null && problem === null && <Status>{strings.loading}</Status>}
      {problem !== null && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
      {people?.length === 0 && (
        <p className="text-muted-fg">
          {searching ? strings.people_none_found : strings.people_empty}
        </p>
      )}
      {people !== null && people.length > 0 && (
        <ul className="flex flex-col gap-1">
          {people.map((person) => {
            const inGroup = taken.has(person.accountId);
            return (
              <li key={person.accountId}>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={inGroup || picked.has(person.accountId)}
                    disabled={inGroup || busy}
                    onChange={() => toggle(person.accountId)}
                    className="size-5"
                  />
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
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {more !== null && (
        <Button disabled={busy} onClick={more}>
          {strings.history_load_older}
        </Button>
      )}
      <Status>
        {failed === "unreachable" && strings.error_unreachable}
        {failed === "failed" && strings.error_generic}
      </Status>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" disabled={busy || picked.size === 0} onClick={confirm}>
          {strings.add_people_confirm}
        </Button>
        <Button disabled={busy} onClick={cancel}>
          {strings.cancel}
        </Button>
      </div>
    </div>
  );
}

/** Loads the directory for what is typed, a page at a time, and holds what is picked. */
export function PeoplePicker({
  taken,
  busy,
  failed,
  add,
  cancel,
}: Readonly<{
  taken: ReadonlySet<string>;
  busy: boolean;
  failed: GroupProblem | null;
  add: (accounts: string[]) => void;
  cancel: () => void;
}>) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // A page of the directory, or the first one of a new search.
  const load = useCallback(
    async (after: string | null, live: () => boolean) => {
      const result = await outcome(
        listPeople({
          query: {
            limit: PAGE,
            ...(searched === "" ? {} : { q: searched }),
            ...(after === null ? {} : { after }),
          },
        }),
        200,
      );
      if (!live()) return;
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      setProblem(null);
      setPeople((have) => (after === null ? [] : (have ?? [])).concat(result.data.people));
      setNext(result.data.next);
    },
    [searched],
  );
  useEffect(() => {
    let live = true;
    setPeople(null);
    setNext(null);
    void load(null, () => live);
    return () => {
      live = false;
    };
  }, [load]);

  function toggle(account: string) {
    setPicked((have) => {
      const now = new Set(have);
      if (!now.delete(account)) now.add(account);
      return now;
    });
  }

  return (
    <PeopleChoice
      people={people}
      problem={problem}
      searching={searched !== ""}
      query={query}
      setQuery={setQuery}
      taken={taken}
      picked={picked}
      toggle={toggle}
      more={next === null ? null : () => void load(next, () => true)}
      confirm={() => add([...picked])}
      cancel={cancel}
      busy={busy}
      failed={failed}
    />
  );
}
