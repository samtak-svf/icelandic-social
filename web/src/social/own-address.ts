// What a person shares (decision 0080) and what the apps open as a screen (decision 0121).
// api/link.vectors.json holds the address, with the core reading it back to its target.

/** The address of a community's page. */
export function communityAddress(communityId: string, origin: string = location.origin): string {
  return `${origin}/communities/${communityId}`;
}

/** The address of a post's page. */
export function postAddress(postId: string, origin: string = location.origin): string {
  return `${origin}/posts/${postId}`;
}
