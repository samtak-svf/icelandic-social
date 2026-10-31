import { strings } from "../generated/brand/strings.ts";

// The wall's three tabs (decision 0115). The tab is a search parameter, so a
// person's wall and one's own share one route shape; no tab means Innlegg.

export type WallTab = "posts" | "about" | "images";

export function validateWallSearch(search: Record<string, unknown>): { tab?: WallTab } {
  return search.tab === "about" || search.tab === "images" ? { tab: search.tab } : {};
}

const TABS: readonly { tab: WallTab; label: string }[] = [
  { tab: "posts", label: strings.wall_tab_posts },
  { tab: "about", label: strings.wall_tab_about },
  { tab: "images", label: strings.wall_tab_images },
];

export function WallTabs({
  tab = "posts",
  onTab,
}: Readonly<{ tab: WallTab | undefined; onTab: (tab: WallTab | undefined) => void }>) {
  return (
    <nav className="sticky top-0 z-10 flex border-b border-border bg-bg">
      {TABS.map((entry) => (
        <button
          key={entry.tab}
          type="button"
          aria-current={tab === entry.tab ? "page" : undefined}
          onClick={() => onTab(entry.tab === "posts" ? undefined : entry.tab)}
          className="inline-flex min-h-11 flex-1 items-center justify-center border-b-2 border-transparent px-1.5 font-medium text-muted-fg aria-[current=page]:border-fg aria-[current=page]:text-fg"
        >
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
