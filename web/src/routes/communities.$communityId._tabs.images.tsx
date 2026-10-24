import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { listCommunityImages } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ImageGrid } from "../social/image-grid.tsx";
import { outcome } from "../social/outcome.ts";
import { usePaged } from "../social/paged.ts";
import { ProblemText, Status } from "../ui/kit.tsx";

// Myndir (decision 0089): every image in the community's posts and comments
// the reader may see, newest first, a page at a time as the feed is.
export const Route = createFileRoute("/communities/$communityId/_tabs/images")({
  component: ImagesTab,
});

function ImagesTab() {
  const { communityId } = Route.useParams();
  const fetchPage = useCallback(
    async (cursor: string | undefined) => {
      const page = await outcome(
        listCommunityImages({ path: { communityId }, query: cursor ? { cursor } : {} }),
        200,
      );
      return page.ok
        ? { ok: true as const, data: { posts: page.data.images, next: page.data.next } }
        : page;
    },
    [communityId],
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
  return (
    <>
      <ImageGrid images={items} sentinel={sentinel} />
      {problem !== null && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
    </>
  );
}
