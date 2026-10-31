import { useCallback, useState } from "react";
import {
  friendSuggestionSettings,
  listFriendSuggestions,
  sendFriendRequest,
  type Profile,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button } from "../ui/kit.tsx";
import { FriendRow } from "./friend-row.tsx";
import { outcome, useLoad } from "./outcome.ts";
import { usePaged } from "./paged.ts";
import { shownSuggestions, suggestionPage } from "./suggestions.ts";
import type { useAct } from "./use-act.ts";

/** The section as drawn: no heading at all when there is nobody to show. */
export function SuggestionsView({
  people,
  busy,
  ask,
  sentinel,
}: Readonly<{
  people: readonly Profile[];
  busy: boolean;
  ask: (person: Profile) => void;
  sentinel?: (node: Element | null) => void;
}>) {
  if (people.length === 0) return null;
  return (
    <section className="mt-6 flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{strings.friends_suggested}</h2>
      <ul className="flex flex-col gap-1">
        {people.map((person) => (
          <FriendRow key={person.accountId} person={person}>
            <Button tone="primary" disabled={busy} onClick={() => ask(person)}>
              {strings.person_add_friend}
            </Button>
          </FriendRow>
        ))}
        {sentinel !== undefined && <li ref={sentinel} aria-hidden="true" />}
      </ul>
    </section>
  );
}

/**
 * Below the friends and requests. It reads on its own, so a failed read shows
 * nothing and leaves the lists above as they are.
 */
export function SuggestedPeople({ actions }: Readonly<{ actions: ReturnType<typeof useAct> }>) {
  const [setting] = useLoad(useCallback(() => outcome(friendSuggestionSettings(), 200), []));
  if (setting?.ok !== true || !setting.data.included) return null;
  return <Suggested actions={actions} />;
}

function Suggested({ actions }: Readonly<{ actions: ReturnType<typeof useAct> }>) {
  const fetchPage = useCallback(
    (after: string | undefined) => suggestionPage((args) => listFriendSuggestions(args), after),
    [],
  );
  const { items, sentinel } = usePaged(fetchPage, (person) => person.accountId);
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const ask = (person: Profile) =>
    actions.act(async () => {
      const result = await outcome(
        sendFriendRequest({ path: { accountId: person.accountId } }),
        200,
      );
      if (result.ok) setAsked((now) => new Set(now).add(person.accountId));
      return result;
    });
  return (
    <SuggestionsView
      people={shownSuggestions(true, items, asked)}
      busy={actions.busy}
      ask={ask}
      sentinel={sentinel}
    />
  );
}
