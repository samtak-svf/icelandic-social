import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { useMe } from "../account.tsx";
import { getCommunity, type Community, type Post } from "../generated/api.ts";
import { outcome, useLoad } from "./outcome.ts";
import { moderatesAs } from "./roles.tsx";

// Where a post belongs (decision 0115): the community it was written in, or
// the wall it was written on, which is Ég for its owner and a person's screen
// for anyone else. A wall has no community to ask a role of.

/** Leaves a post that was deleted or removed, for the place it belonged to. */
export function useLeavePost(post: Post): () => void {
  const navigate = useNavigate();
  const me = useMe();
  return () => {
    if (post.wall === undefined) {
      void navigate({ to: "/communities/$communityId", params: { communityId: post.communityId } });
    } else if (post.wall.accountId === me?.accountId) {
      void navigate({ to: "/" });
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
    <Link to="/" className={className}>
      {children}
    </Link>
  ) : (
    <Link to="/people/$accountId" params={{ accountId: post.wall.accountId }} className={className}>
      {children}
    </Link>
  );
}

const held = (role: Community["role"]) => ({ ok: true as const, data: { role } });

/** Whether the reader moderates the post's community; a wall has none, so never there. */
export function useModerates(post: Post): boolean {
  const { communityId } = post;
  const onWall = post.wall !== undefined;
  const [community] = useLoad<{ role: Community["role"] }>(
    useCallback(
      () =>
        onWall
          ? Promise.resolve(held(null))
          : outcome(getCommunity({ path: { communityId } }), 200).then((found) =>
              found.ok ? held(found.data.role) : found,
            ),
      [communityId, onWall],
    ),
  );
  return community?.ok === true && moderatesAs(community.data.role);
}
