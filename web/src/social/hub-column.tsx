import type { Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { CommunityList, CreateRow } from "./community-card.tsx";
import type { Outcome } from "./outcome.ts";

// The reader's communities in a column beside the feed (decision 0087): shown
// from the expanded size class up, hidden below it by the stylesheet, so a
// server render is right at every width. The server orders the list, pinned
// first and then by last activity, and each row carries its unread count.

/** The class that draws the column: hidden below expanded, sticky beside the feed on it. */
const HUB_COLUMN =
  "hidden flex-col gap-2 rounded-md border border-border p-4 expanded:sticky expanded:top-6 expanded:flex expanded:max-h-[calc(100dvh-3rem)] expanded:overflow-y-auto";

export function HubColumn({
  mine,
  reloadMine,
  verified,
}: Readonly<{
  mine: Outcome<{ communities: Community[] }> | null;
  reloadMine: () => void;
  verified: boolean;
}>) {
  return (
    <aside aria-labelledby="hub-column" className={HUB_COLUMN}>
      <h2 id="hub-column" className="text-xl font-semibold">
        {strings.communities_mine}
      </h2>
      {verified && <CreateRow />}
      {mine === null && <Status>{strings.loading}</Status>}
      {mine?.ok === false && (
        <Status>
          <ProblemText problem={mine.problem} />
        </Status>
      )}
      {mine?.ok && mine.data.communities.length === 0 && (
        <p className="text-muted-fg">{strings.communities_empty}</p>
      )}
      {mine?.ok && <CommunityList communities={mine.data.communities} changed={reloadMine} />}
    </aside>
  );
}
