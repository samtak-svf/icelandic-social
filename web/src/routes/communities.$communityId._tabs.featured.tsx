import { createFileRoute } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";
import { useCommunityTab } from "../social/community-frame.tsx";
import { mayReplyTo, moderatesAs } from "../social/roles.tsx";
import { PostView } from "../social/post.tsx";

// Fest (decisions 0088, 0089): the featured posts as full cards, newest pin
// first. The tab is hidden while none is featured.
export const Route = createFileRoute("/communities/$communityId/_tabs/featured")({
  component: FeaturedTab,
});

function FeaturedTab() {
  const { community, changed } = useCommunityTab();
  if (community.featured.length === 0)
    return <p className="text-muted-fg">{strings.posts_empty}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {community.featured.map((post) => (
        <li key={post.postId}>
          <PostView
            post={post}
            linked
            deleted={changed}
            changed={changed}
            moderates={moderatesAs(community.role)}
            mayReply={mayReplyTo(post, community)}
          />
        </li>
      ))}
    </ul>
  );
}
