import { type SocialMedia } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { useMediaSrc, useViewer } from "./viewer.tsx";

/** A comment's image (decision 0082): at the bubble's width; pressing it opens the viewer. */
export function CommentImage({ postId, media }: Readonly<{ postId: string; media: SocialMedia }>) {
  const src = useMediaSrc(postId, media.mediaId);
  const { open, viewer } = useViewer();
  const alt = strings.comment_image_alt;
  return (
    <>
      <button
        type="button"
        aria-label={alt}
        onClick={() => open([{ postId, media, alt }], 0)}
        className="block w-full overflow-hidden rounded-md bg-bg"
        style={{ aspectRatio: `${media.width} / ${media.height}` }}
      >
        {src !== null && (
          <img
            src={src}
            alt=""
            width={media.width}
            height={media.height}
            className="size-full object-cover"
          />
        )}
      </button>
      {viewer}
    </>
  );
}
