// What a comment box may send (decision 0082): text, an image, or both.

/** Whether the send button is enabled. */
export function canSendComment({
  text,
  hasImage,
  busy,
}: {
  text: string;
  hasImage: boolean;
  busy: boolean;
}): boolean {
  return !busy && (text.trim() !== "" || hasImage);
}

/** The `media` of the create-comment body: the uploaded image's id, or none. */
export function commentMedia(mediaId: string | null): string[] {
  return mediaId === null ? [] : [mediaId];
}
