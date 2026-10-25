import type { Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { CommunityHeader, type PreviewImages } from "./community-header.tsx";

// The live preview beside the create form on an expanded window (decision
// 0087): the community header as the page will show it, at the reader's own
// size class, fed with what the form holds. Drawn by the stylesheet, hidden
// below expanded, so a server render is right at every width.

/** What the form holds. */
export type Draft = { name: string; description: string; audience: "open" | "private" };

/** A community that does not exist yet, as far as the header can tell. */
export function draftCommunity(draft: Draft): Community {
  return {
    communityId: "preview",
    name: draft.name.trim(),
    description: draft.description.trim(),
    audience: draft.audience,
    createdAt: 0,
    memberCount: 1,
    role: "owner",
    joinRequested: false,
    invited: false,
    mutedUntil: null,
    readOnly: false,
    deletedAt: null,
    joinDeclinedUntil: null,
    pendingJoinRequests: null,
    openReports: null,
    photo: null,
    cover: null,
    photoFrames: null,
    coverFrames: null,
    unread: 0,
    lastPostAt: null,
    pinned: false,
    featured: [],
    anonymousPosts: false,
    pendingAnonymous: 0,
  };
}

export function CommunityPreview({
  draft,
  images,
}: Readonly<{ draft: Draft; images: PreviewImages }>) {
  return (
    <section
      aria-label={strings.community_preview}
      className="hidden rounded-md border border-border p-4 expanded:sticky expanded:mt-4 expanded:top-6 expanded:block"
    >
      <CommunityHeader community={draftCommunity(draft)} preview={images} />
    </section>
  );
}
