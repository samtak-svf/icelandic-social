import { sizeClassOf, type SizeClass } from "../generated/frames.ts";

// What each size class lays out (decision 0087): the one map from a size
// class to a layout. The stylesheet draws it with the generated `medium:` and
// `expanded:` variants, which keeps a server render right at every width;
// the tests read this map to know what to expect at a width.

export type Layout = {
  /** The five places: a bar at the bottom of the screen, or a rail down the left. */
  navigation: "bar" | "rail";
  /** The community page: one column, or the feed with Um samfélagið beside it. */
  community: "column" | "feed-and-aside";
  /** How many members' pictures the community header or aside shows at most. */
  memberPictures: number;
};

export const LAYOUTS: Readonly<Record<SizeClass, Layout>> = {
  compact: { navigation: "bar", community: "column", memberPictures: 5 },
  medium: { navigation: "rail", community: "column", memberPictures: 12 },
  expanded: { navigation: "rail", community: "feed-and-aside", memberPictures: 12 },
};

/** The layout of a window `width` CSS px wide. */
export function layoutOf(width: number): Layout {
  return LAYOUTS[sizeClassOf(width)];
}
