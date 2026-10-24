-- A comment carries at most one image (decision 0082). The row keeps the
-- comment's post in post_id, so every path that deletes a post's images by
-- post id reaches it, and the comment in comment_id. removed_at is when a
-- moderator removed the comment: the daily purge deletes the image
-- REMOVED_KEPT_MS later, the window in which the space deletes the text.
-- Additive only (decision 0068).
ALTER TABLE social_media ADD COLUMN comment_id TEXT;
ALTER TABLE social_media ADD COLUMN removed_at INTEGER;

CREATE INDEX social_media_by_comment ON social_media (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX social_media_removed ON social_media (removed_at) WHERE removed_at IS NOT NULL;
