import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  createCommunity,
  listCommunities,
  myCommunities,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, useLoad } from "../social/outcome.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// Communities (decision 0063): the ones the person is in, finding one by
// name, and, for a verified account, creating one.
export const Route = createFileRoute("/communities/")({ component: Communities });

function Communities() {
  const { state } = useAccount();
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  if (state.status !== "signed-in") return null;
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.tab_communities}</h1>
      <section aria-labelledby="mine" className="mt-6">
        <h2 id="mine" className="text-xl font-semibold">
          {strings.communities_mine}
        </h2>
        {mine === null && <Status>{strings.loading}</Status>}
        {mine?.ok === false && (
          <Status>
            <ProblemText problem={mine.problem} />
          </Status>
        )}
        {mine?.ok && mine.data.communities.length === 0 && (
          <p className="mt-2 text-muted-fg">{strings.communities_empty}</p>
        )}
        {mine?.ok && <CommunityList communities={mine.data.communities} />}
      </section>
      <Find />
      {state.me.verified && <Create />}
    </>
  );
}

function CommunityList({ communities }: Readonly<{ communities: Community[] }>) {
  if (communities.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {communities.map((c) => (
        <li key={c.communityId}>
          <Link
            to="/communities/$communityId"
            params={{ communityId: c.communityId }}
            className="flex min-h-11 flex-col justify-center rounded-md border border-border px-4 py-2"
          >
            <span className="font-semibold">{c.name}</span>
            <span className="text-sm text-muted-fg">
              {c.audience === "open" ? strings.community_open : strings.community_private}
              {c.memberCount !== null &&
                ` · ${strings.community_members({ count: c.memberCount })}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Find() {
  const search = useId();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Community[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const result = await outcome(
      listCommunities({ query: q.trim() === "" ? {} : { q: q.trim() } }),
      200,
    );
    if (result.ok) setFound(result.data.communities);
    else setProblem(result.problem);
  }

  return (
    <section aria-labelledby={`${search}-h`} className="mt-8">
      <h2 id={`${search}-h`} className="text-xl font-semibold">
        {strings.communities_find}
      </h2>
      <form role="search" onSubmit={(event) => void find(event)} className="mt-2 flex gap-2">
        <input
          id={search}
          type="search"
          aria-label={strings.communities_find}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          className="min-h-11 flex-1 rounded-md border border-border-strong bg-surface px-3"
        />
        <Button tone="primary" type="submit">
          {strings.communities_find}
        </Button>
      </form>
      {found?.length === 0 && (
        <p className="mt-2 text-muted-fg">{strings.communities_none_found}</p>
      )}
      {found && <CommunityList communities={found} />}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}

function Create() {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"open" | "private">("open");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const made = await outcome(
      createCommunity({ body: { name: name.trim(), description: description.trim(), audience } }),
      200,
    );
    setBusy(false);
    if (made.ok) {
      await navigate({
        to: "/communities/$communityId",
        params: { communityId: made.data.communityId },
      });
    } else setProblem(made.problem);
  }

  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <section aria-labelledby={`${id}-h`} className="mt-8">
      <h2 id={`${id}-h`} className="text-xl font-semibold">
        {strings.community_create}
      </h2>
      <form onSubmit={(event) => void create(event)} className="mt-2 flex flex-col gap-2">
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
                onChange={() => setAudience(value)}
              />
              <span>
                <span className="font-semibold">
                  {value === "open" ? strings.community_open : strings.community_private}
                </span>
                {": "}
                {value === "open" ? strings.community_open_hint : strings.community_private_hint}
              </span>
            </label>
          ))}
        </fieldset>
        <Button tone="primary" type="submit" disabled={busy || name.trim() === ""}>
          {strings.community_create}
        </Button>
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      </form>
    </section>
  );
}
