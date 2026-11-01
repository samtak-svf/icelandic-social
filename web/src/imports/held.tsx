import { useCallback, useId, useState } from "react";
import {
  deletePost,
  listHeldPosts,
  openHeldPosts,
  type ImportDetail,
  type Post,
  type WallAudience,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { WallAudienceFields } from "../social/audience.tsx";
import { outcome } from "../social/outcome.ts";
import { usePaged, type Paged } from "../social/paged.ts";
import { Body, Images, PostMarks } from "../social/post.tsx";
import { PostHeading, postByline } from "../social/post-heading.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { CLASS_LABEL, type ItemClass } from "./classes.tsx";

// What an import holds until the person opens it (decision 0127): the real posts, for them
// alone. One filter names both what is listed and what opens, so what they read is what
// goes out, and the first audience offered is friends, never everyone.

type Held = ImportDetail["held"];

/** Which held posts are meant; a field left out means all of them. */
export type HeldFilter = { class?: ItemClass; year?: number };

/** Whether the import has finished bringing posts in and holds some: a failed one may have. */
export const mayOpen = (status: ImportDetail) =>
  (status.state === "done" || status.state === "failed") && status.held.posts > 0;

/** How many held posts a filter names. */
export function heldCount(held: Held, filter: HeldFilter): number {
  return held.groups
    .filter(
      (group) =>
        (filter.class === undefined || group.class === filter.class) &&
        (filter.year === undefined || group.year === filter.year),
    )
    .reduce((sum, group) => sum + group.posts, 0);
}

const unique = <T,>(values: T[]) => [...new Set(values)];

/** The question asked before opening: it says how many, and to whom. */
export const openQuestion = (audience: WallAudience, count: number) =>
  audience === "friends"
    ? strings.imports_held_confirm_friends({ count })
    : strings.imports_held_confirm_everyone({ count });

function Pick({
  label,
  value,
  all,
  options,
  change,
  disabled,
}: Readonly<{
  label: string;
  value: string;
  all: string;
  options: readonly { value: string; label: string }[];
  change: (value: string) => void;
  disabled: boolean;
}>) {
  const id = useId();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <select
        id={id}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The real post, without what a reader does to one: nobody reads it yet. */
function HeldCard({ post, removed }: Readonly<{ post: Post; removed: () => void }>) {
  const [problem, setProblem] = useState<Problem | null>(null);

  async function remove() {
    if (!confirm(strings.post_delete_confirm)) return;
    setProblem(null);
    const done = await outcome(deletePost({ path: { postId: post.postId } }), 204);
    if (done.ok) removed();
    else setProblem(done.problem);
  }

  return (
    <li>
      <article
        aria-label={postByline(post)}
        className="flex flex-col gap-2 rounded-md border border-border p-4"
      >
        <PostMarks post={post} />
        <header className="flex items-start gap-3">
          <PostHeading post={post} community={null} />
        </header>
        {post.body !== "" && <Body post={post} linked={false} />}
        {post.media.length > 0 && <Images postId={post.postId} media={post.media} />}
        <div>
          <Button tone="danger" onClick={() => void remove()}>
            {strings.delete}
          </Button>
        </div>
        <Status inline>{problem !== null && <ProblemText problem={problem} />}</Status>
      </article>
    </li>
  );
}

/** The filters, the audience, the button and the posts. Draws what it is given. */
export function HeldView({
  held,
  list,
  filter,
  change,
  audience,
  changeAudience,
  open,
  removed,
  busy = false,
}: Readonly<{
  held: Held;
  list: Paged<Post>;
  filter: HeldFilter;
  change: (next: HeldFilter) => void;
  audience: WallAudience;
  changeAudience: (next: WallAudience) => void;
  open: () => void;
  removed: () => void;
  busy?: boolean;
}>) {
  const count = heldCount(held, filter);
  const classes = unique(held.groups.map((group) => group.class));
  const years = unique(held.groups.map((group) => group.year)).sort((a, b) => b - a);
  const classOption = (name: ItemClass) => {
    const posts = heldCount(held, { ...filter, class: name });
    return { value: name, label: `${CLASS_LABEL[name]} (${posts})` };
  };
  const yearOption = (year: number) => {
    const posts = heldCount(held, { ...filter, year });
    return { value: String(year), label: `${year} (${posts})` };
  };

  function pickClass(value: string) {
    const { class: _left, ...rest } = filter;
    const chosen = held.groups.find((group) => group.class === value)?.class;
    change(chosen === undefined ? rest : { ...rest, class: chosen });
  }

  function pickYear(value: string) {
    const { year: _left, ...rest } = filter;
    change(value === "" ? rest : { ...rest, year: Number(value) });
  }

  return (
    <section className="mt-6">
      <h2 className="font-headline text-2xl">{strings.imports_held_title}</h2>
      <p className="mt-2">{strings.imports_held_intro}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Pick
          label={strings.imports_held_class}
          value={filter.class ?? ""}
          all={strings.imports_held_all_classes}
          options={classes.map(classOption)}
          change={pickClass}
          disabled={busy}
        />
        <Pick
          label={strings.imports_held_year}
          value={filter.year === undefined ? "" : String(filter.year)}
          all={strings.imports_held_all_years}
          options={years.map(yearOption)}
          change={pickYear}
          disabled={busy}
        />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <WallAudienceFields value={audience} onChange={changeAudience} disabled={busy} />
        <div>
          <Button tone="primary" onClick={open} disabled={busy || count === 0}>
            {strings.imports_held_open({ count })}
          </Button>
        </div>
      </div>
      {count === 0 && <p className="mt-4 text-muted-fg">{strings.imports_held_empty}</p>}
      {list.items === null ? (
        <Status>
          {list.problem === null ? strings.loading : <ProblemText problem={list.problem} />}
        </Status>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3 empty:hidden">
            {list.items.map((post) => (
              <HeldCard key={post.postId} post={post} removed={removed} />
            ))}
          </ul>
          {list.hasMore && <div ref={list.sentinel} />}
          {list.problem !== null && (
            <Status>
              <ProblemText problem={list.problem} />
            </Status>
          )}
        </>
      )}
    </section>
  );
}

/** The held posts, wired to the API. `changed` reads the counts again after a delete. */
export function HeldSection({
  importId,
  held,
  changed,
  opened,
}: Readonly<{
  importId: string;
  held: Held;
  changed: () => void;
  opened: (count: number) => void;
}>) {
  const [filter, setFilter] = useState<HeldFilter>({});
  const [audience, setAudience] = useState<WallAudience>("friends");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const fetchPage = useCallback(
    (before: string | undefined) =>
      outcome(
        listHeldPosts({
          path: { importId },
          query: { ...filter, ...(before === undefined ? {} : { before }) },
        }),
        200,
      ),
    [importId, filter],
  );
  const list = usePaged<Post>(fetchPage, (post) => post.postId);

  async function open() {
    if (!confirm(openQuestion(audience, heldCount(held, filter)))) return;
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      openHeldPosts({ path: { importId }, body: { ...filter, audience } }),
      200,
    );
    setBusy(false);
    if (done.ok) {
      setFilter({});
      opened(done.data.opened);
      list.reload();
    } else setProblem(done.problem);
  }

  return (
    <>
      <HeldView
        held={held}
        list={list}
        filter={filter}
        change={setFilter}
        audience={audience}
        changeAudience={setAudience}
        open={() => void open()}
        removed={() => {
          changed();
          list.reload();
        }}
        busy={busy}
      />
      <Status inline>{problem !== null && <ProblemText problem={problem} />}</Status>
    </>
  );
}
