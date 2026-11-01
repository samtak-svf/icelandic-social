import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  blockAccount,
  getPerson,
  getWall,
  listWallImages,
  listWallPosts,
  type Person,
  type WallProfile,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { VerifyCta } from "../ui/verify.tsx";
import { Avatar, Cover } from "./avatar.tsx";
import { PostComposer } from "./composer.tsx";
import { ImageGrid } from "./image-grid.tsx";
import { outcome, useLoad } from "./outcome.ts";
import { usePaged } from "./paged.ts";
import { PersonMenu, RelationActions, Shared } from "./person-parts.tsx";
import { PostView } from "./post.tsx";
import { mayReplyTo } from "./roles.tsx";
import { ReportForm } from "./report.tsx";
import { useSuspended } from "./suspended.tsx";
import { useAct } from "./use-act.ts";
import { BioLine, CoverControls, PhotoControls } from "./wall-edit.tsx";
import { WallTabs, type WallTab } from "./wall-tabs.tsx";
import { formatIsDate, formatIsMonth } from "../lib/is-format.ts";

// A wall (decision 0115): the one layout of Ég and of a person's screen. The
// cover, the picture that overlaps it, the name, the bio, then Innlegg, Um and
// Myndir. Whoever owns the wall gets the controls to change it; a viewer who
// may read nothing of it sees the same page with nothing under the tabs.

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function Badge({
  label,
  onPress,
  className,
}: Readonly<{ label: string; onPress: () => void; className: string }>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={`absolute inline-flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface ${className}`}
    >
      <CameraIcon />
    </button>
  );
}

export function WallScreen({
  accountId,
  tab,
  onTab,
}: Readonly<{
  accountId: string;
  tab: WallTab | undefined;
  onTab: (tab: WallTab | undefined) => void;
}>) {
  const [person, reloadPerson] = useLoad(
    useCallback(() => outcome(getPerson({ path: { accountId } }), 200), [accountId]),
  );
  const [wall, reloadWall] = useLoad(
    useCallback(() => outcome(getWall({ path: { accountId } }), 200), [accountId]),
  );
  if (person === null || wall === null) return <Status>{strings.loading}</Status>;
  if (!person.ok) {
    return (
      <Status>
        <ProblemText problem={person.problem} />
      </Status>
    );
  }
  const reload = () => {
    reloadPerson();
    reloadWall();
  };
  return (
    <Wall
      person={person.data}
      wall={wall.ok ? wall.data : null}
      tab={tab}
      onTab={onTab}
      reload={reload}
    />
  );
}

function Wall({
  person,
  wall,
  tab,
  onTab,
  reload,
}: Readonly<{
  person: Person;
  wall: WallProfile | null;
  tab: WallTab | undefined;
  onTab: (tab: WallTab | undefined) => void;
  reload: () => void;
}>) {
  const { accountId } = person;
  const owner = person.relation === "self";
  const suspended = useSuspended();
  const [dialog, setDialog] = useState<"photo" | "cover" | null>(null);
  return (
    <>
      <div className="relative">
        {wall?.cover != null ? (
          <Cover
            communityId={accountId}
            kind="wallCover"
            version={wall.cover}
            className="rounded-md"
          />
        ) : (
          <div className="h-24 rounded-md bg-muted" />
        )}
        {owner && (
          <Badge
            label={strings.wall_cover_alt}
            onPress={() => setDialog("cover")}
            className="right-2 top-2"
          />
        )}
      </div>
      <div className="relative -mt-10 ml-4 w-fit">
        <Avatar
          kind="person"
          id={accountId}
          name={person.name}
          photo={person.photo}
          alt={owner ? strings.photo_own_alt : undefined}
          className="size-24 rounded-post-bubble border-4 border-bg text-3xl"
        />
        {owner && (
          <Badge
            label={person.photo === null ? strings.photo_choose : strings.photo_change}
            onPress={() => setDialog("photo")}
            className="-bottom-2 -right-4"
          />
        )}
      </div>
      <Header person={person} wall={wall} owner={owner} suspended={suspended} reload={reload} />
      <WallTabs tab={tab} onTab={onTab} />
      <div className="mt-4">
        {(tab ?? "posts") === "posts" && <PostsTab accountId={accountId} owner={owner} />}
        {tab === "about" && <AboutTab person={person} wall={wall} />}
        {tab === "images" && <ImagesTab accountId={accountId} />}
      </div>
      <WallDialogs
        which={dialog}
        person={person}
        wall={wall}
        suspended={suspended}
        reload={reload}
        close={() => setDialog(null)}
      />
    </>
  );
}

function WallDialogs({
  which,
  person,
  wall,
  suspended,
  reload,
  close,
}: Readonly<{
  which: "photo" | "cover" | null;
  person: Person;
  wall: WallProfile | null;
  suspended: boolean;
  reload: () => void;
  close: () => void;
}>) {
  if (which === "photo") {
    return (
      <Dialog title={strings.photo_change} onClose={close}>
        <PhotoControls
          accountId={person.accountId}
          photo={person.photo}
          changed={() => {
            reload();
            close();
          }}
        />
      </Dialog>
    );
  }
  if (which === "cover") {
    return (
      <Dialog title={strings.wall_cover_alt} onClose={close}>
        <CoverControls
          cover={wall?.cover ?? null}
          coverFrames={wall?.coverFrames ?? null}
          suspended={suspended}
          changed={reload}
        />
      </Dialog>
    );
  }
  return null;
}

function Header({
  person,
  wall,
  owner,
  suspended,
  reload,
}: Readonly<{
  person: Person;
  wall: WallProfile | null;
  owner: boolean;
  suspended: boolean;
  reload: () => void;
}>) {
  const { accountId } = person;
  const name = person.name ?? strings.person_unnamed;
  const navigate = useNavigate();
  const { busy, problem, act } = useAct(reload);
  const [reporting, setReporting] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const path = { path: { accountId } };
  const block = () => {
    if (!confirm(strings.block_confirm({ name }))) return;
    void outcome(blockAccount(path), 204).then((result) => {
      if (result.ok) void navigate({ to: "/friends" });
    });
  };
  return (
    <section className="mb-4 mt-2 flex flex-col gap-2 px-1">
      <h1 className="break-words text-2xl font-semibold">
        {name}
        {person.verified && <VerifiedMark className="ml-2 text-base" />}
      </h1>
      <BioLine bio={wall?.bio ?? null} owner={owner} suspended={suspended} changed={reload} />
      <Counts person={person} wall={wall} owner={owner} />
      {person.friendsSince !== null && (
        <p className="text-sm text-muted-fg">
          {strings.person_friends_since({ date: formatIsDate(person.friendsSince) })}
        </p>
      )}
      {person.snoozedUntil !== null && (
        <p className="text-sm text-muted-fg">
          {strings.person_snoozed_until({ date: formatIsDate(person.snoozedUntil) })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {owner && <VerifyCta />}
        <RelationActions relation={person.relation} path={path} busy={busy} act={act} />
        {!owner && (
          <PersonMenu
            person={person}
            act={act}
            block={block}
            report={() => setReporting(true)}
            told={setTold}
          />
        )}
      </div>
      {problem !== null && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
      {told !== null && <Status>{told}</Status>}
      {reporting && (
        <ReportForm
          target={{ kind: "account", id: accountId }}
          onSent={() => {
            setReporting(false);
            setTold(strings.report_sent);
          }}
        />
      )}
    </section>
  );
}

function PostsTab({ accountId, owner }: Readonly<{ accountId: string; owner: boolean }>) {
  const fetchPage = useCallback(
    (before: string | undefined) =>
      outcome(listWallPosts({ path: { accountId }, query: before ? { before } : {} }), 200),
    [accountId],
  );
  const { items, problem, sentinel, reload } = usePaged(fetchPage, (post) => post.postId);
  return (
    <section className="flex flex-col gap-4">
      {owner && <PostComposer wall posted={reload} />}
      {items === null && problem === null && <Status>{strings.loading}</Status>}
      {items?.length === 0 && <p className="text-muted-fg">{strings.posts_empty}</p>}
      {items !== null && items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((post) => (
            <li key={post.postId}>
              <PostView
                post={post}
                linked
                deleted={reload}
                changed={reload}
                moderates={false}
                mayReply={mayReplyTo(post)}
              />
            </li>
          ))}
          <li ref={sentinel} aria-hidden="true" />
        </ul>
      )}
      {problem !== null && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
    </section>
  );
}

function AboutTab({ person, wall }: Readonly<{ person: Person; wall: WallProfile | null }>) {
  return (
    <section className="flex flex-col gap-2">
      {wall !== null && <p>{strings.wall_joined({ month: formatIsMonth(wall.joinedMonth) })}</p>}
      {person.relation !== "self" && <Shared person={person} />}
    </section>
  );
}

function ImagesTab({ accountId }: Readonly<{ accountId: string }>) {
  const fetchPage = useCallback(
    async (cursor: string | undefined) => {
      const page = await outcome(
        listWallImages({ path: { accountId }, query: cursor ? { cursor } : {} }),
        200,
      );
      return page.ok
        ? { ok: true as const, data: { posts: page.data.images, next: page.data.next } }
        : page;
    },
    [accountId],
  );
  const { items, problem, sentinel } = usePaged(fetchPage, (image) => image.mediaId);
  if (items === null) {
    return problem === null ? (
      <Status>{strings.loading}</Status>
    ) : (
      <Status>
        <ProblemText problem={problem} />
      </Status>
    );
  }
  return <ImageGrid images={items} sentinel={sentinel} />;
}

function Counts({
  person,
  wall,
  owner,
}: Readonly<{ person: Person; wall: WallProfile | null; owner: boolean }>) {
  const friends = strings.person_friend_count({ count: person.friendCount });
  return (
    <p className="text-muted-fg">
      {owner ? (
        <Link to="/friends" className="underline">
          {friends}
        </Link>
      ) : (
        friends
      )}
      {!owner && person.mutualCount > 0 && (
        <> · {strings.person_mutual_count({ count: person.mutualCount })}</>
      )}
      {wall !== null && <> · {strings.wall_joined({ month: formatIsMonth(wall.joinedMonth) })}</>}
    </p>
  );
}
