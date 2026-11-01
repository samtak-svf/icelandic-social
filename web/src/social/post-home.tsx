import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { useMe } from "../account.tsx";
import { getCommunity, type Community, type Post } from "../generated/api.ts";
import { outcome, useLoad } from "./outcome.ts";
import { postStanding, type PostStanding } from "./roles.tsx";

// Where a post belongs (decision 0115): the community it was written in, or
// the wall it was written on, which is Ég for its owner and a person's screen
// for anyone else. A wall has no community to ask a standing of.

/** Leaves a post that was deleted or removed, for the place it belonged to. */
export function useLeavePost(post: Post): () => void {
  const navigate = useNavigate();
  const me = useMe();
  return () => {
    if (post.wall === undefined) {
      void navigate({ to: "/communities/$communityId", params: { communityId: post.communityId } });
    } else if (post.wall.accountId === me?.accountId) {
      void navigate({ to: "/me" });
    } else {
      void navigate({ to: "/people/$accountId", params: { accountId: post.wall.accountId } });
    }
  };
}

/** The way back from a post, to the place it belonged to. */
export function PostHomeLink({
  post,
  className,
  children,
}: Readonly<{ post: Post; className: string; children: ReactNode }>) {
  const me = useMe();
  if (post.wall === undefined) {
    return (
      <Link
        to="/communities/$communityId"
        params={{ communityId: post.communityId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return post.wall.accountId === me?.accountId ? (
    <Link to="/me" className={className}>
      {children}
    </Link>
  ) : (
    <Link to="/people/$accountId" params={{ accountId: post.wall.accountId }} className={className}>
      {children}
    </Link>
  );
}

/** What the reader may do on the post's page, as its community stands; a wall has no community. */
export function usePostStanding(post: Post): PostStanding {
  const { communityId } = post;
  const onWall = post.wall !== undefined;
  const [community] = useLoad<Community | null>(
    useCallback(
      () =>
        onWall
          ? Promise.resolve({ ok: true as const, data: null })
          : outcome(getCommunity({ path: { communityId } }), 200),
      [communityId, onWall],
    ),
  );
  return postStanding(post, community);
}
