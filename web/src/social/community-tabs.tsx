import { Link } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";

// The row of tabs under a community's header (decision 0089). Each tab is a
// route, so a link to one works and back returns to the one before. The row
// sticks under the top of the page while it scrolls and scrolls sideways on
// a compact window (`LAYOUTS[..].tabs`); the community's search is an icon at
// its end.

export type CommunityTab = "discussion" | "featured" | "images" | "members" | "about";

const PATHS = {
  featured: "/communities/$communityId/featured",
  images: "/communities/$communityId/images",
  members: "/communities/$communityId/people",
  about: "/communities/$communityId/about",
} as const;

const SUFFIX: Readonly<Record<string, CommunityTab>> = {
  featured: "featured",
  images: "images",
  people: "members",
  about: "about",
};

/** The tab a path of the community is on. */
export function tabOf(pathname: string): CommunityTab {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return Object.hasOwn(SUFFIX, last) ? SUFFIX[last]! : "discussion";
}

/** The tabs a reader gets: only Um without the right to read, and Fest only while a post is featured. */
export function tabsFor(readable: boolean, hasFeatured: boolean): CommunityTab[] {
  if (!readable) return ["about"];
  return [
    "discussion",
    ...(hasFeatured ? (["featured"] as const) : []),
    "images",
    "members",
    "about",
  ];
}

const LABEL: Readonly<Record<CommunityTab, string>> = {
  discussion: strings.community_tab_discussion,
  featured: strings.community_tab_featured,
  images: strings.community_tab_images,
  members: strings.community_tab_members,
  about: strings.community_tab_about,
};

const TAB_CLASS =
  "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 font-medium";

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function CommunityTabs({
  communityId,
  active,
  readable,
  hasFeatured,
  searching,
  onSearch,
}: Readonly<{
  communityId: string;
  active: CommunityTab;
  readable: boolean;
  hasFeatured: boolean;
  /** Whether the search field is open on Umræða. */
  searching: boolean;
  onSearch: () => void;
}>) {
  return (
    <nav
      aria-label={strings.community_tabs}
      className="sticky top-0 z-10 -mx-4 mt-4 flex overflow-x-auto border-b border-border bg-bg px-4 medium:overflow-visible"
    >
      {tabsFor(readable, hasFeatured).map((tab) => {
        const current = tab === active;
        const className = `${TAB_CLASS} ${current ? "border-fg" : "border-transparent text-muted-fg"}`;
        const aria = current ? ("page" as const) : undefined;
        return tab === "discussion" ? (
          <Link
            key={tab}
            to="/communities/$communityId"
            params={{ communityId }}
            aria-current={aria}
            className={className}
          >
            {LABEL[tab]}
          </Link>
        ) : (
          <Link
            key={tab}
            to={PATHS[tab]}
            params={{ communityId }}
            aria-current={aria}
            className={className}
          >
            {LABEL[tab]}
          </Link>
        );
      })}
      {readable && (
        <button
          type="button"
          aria-label={strings.community_search_posts}
          aria-pressed={searching}
          onClick={onSearch}
          className="sticky right-0 ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center bg-bg"
        >
          <SearchIcon />
        </button>
      )}
    </nav>
  );
}
