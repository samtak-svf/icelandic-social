import { Link } from "@tanstack/react-router";
import type { CommunityImage } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { useMediaSrc } from "./viewer.tsx";

// Myndir (decision 0089): the images of a community's posts and comments as a
// grid of squares; a tap opens the post the image belongs to.

function Thumb({ image }: Readonly<{ image: CommunityImage }>) {
  const src = useMediaSrc(image.postId, image.mediaId);
  return src === null ? (
    <div className="size-full animate-pulse bg-muted" />
  ) : (
    <img src={src} alt="" className="size-full object-cover" />
  );
}

/** The grid; `sentinel` is the element after the last image that asks for the next page. */
export function ImageGrid({
  images,
  sentinel,
}: Readonly<{ images: readonly CommunityImage[]; sentinel?: (node: Element | null) => void }>) {
  if (images.length === 0) return <p className="text-muted-fg">{strings.community_images_empty}</p>;
  return (
    <>
      <ul className="grid grid-cols-3 gap-1 medium:grid-cols-4">
        {images.map((image) => (
          <li key={image.mediaId} className="aspect-square overflow-hidden rounded-thumbnail">
            <Link
              to="/posts/$postId"
              params={{ postId: image.postId }}
              aria-label={strings.post_title}
              className="block size-full"
            >
              <Thumb image={image} />
            </Link>
          </li>
        ))}
      </ul>
      {sentinel && <div ref={sentinel} aria-hidden="true" className="h-px" />}
    </>
  );
}
