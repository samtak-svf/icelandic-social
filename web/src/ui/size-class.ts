import { useSyncExternalStore } from "react";
import { SIZE_CLASSES, sizeClassOf, type SizeClass } from "../generated/frames.ts";

// The window's size class (decisions 0086, 0087), from the contract's one
// definition. A stylesheet uses the generated `medium:` and `expanded:`
// variants; code that must branch reads this hook.

export type { SizeClass };

/** The media query that matches from each bounded size class up. */
export const SIZE_QUERIES = {
  medium: `(min-width: ${SIZE_CLASSES.medium}px)`,
  expanded: `(min-width: ${SIZE_CLASSES.expanded}px)`,
} as const;

/** The size class of the window now; expanded where there is no window (the server render). */
export function currentSizeClass(): SizeClass {
  if (typeof window === "undefined") return "expanded";
  return sizeClassOf(window.innerWidth);
}

function onSizeClass(changed: () => void): () => void {
  const queries = Object.values(SIZE_QUERIES).map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", changed);
  return () => {
    for (const query of queries) query.removeEventListener("change", changed);
  };
}

/** The window's size class; it follows a resize or a rotation. */
export function useSizeClass(): SizeClass {
  return useSyncExternalStore(onSizeClass, currentSizeClass, () => "expanded");
}
