import { useCallback } from "react";
import { listCommunityMembers } from "../generated/api.ts";
import { outcome, useLoad } from "./outcome.ts";

/** A community's members, loaded once for every part of a page that shows them. */
export function useMembers(communityId: string) {
  return useLoad(
    useCallback(() => outcome(listCommunityMembers({ path: { communityId } }), 200), [communityId]),
  );
}

export type Members = ReturnType<typeof useMembers>[0];
