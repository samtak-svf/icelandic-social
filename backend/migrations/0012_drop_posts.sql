-- Fljótið and the walls leave v1 (decision 0044): every post, reply and
-- reaction is deleted, and nothing is kept or exported. The tables of
-- 0009_posts.sql go, the children first; their indexes go with them, and are
-- named here so the migration says what it removes.

DROP INDEX IF EXISTS post_reactions_by_account;
DROP TABLE IF EXISTS post_reactions;

DROP INDEX IF EXISTS post_replies_by_post;
DROP INDEX IF EXISTS post_replies_by_author;
DROP TABLE IF EXISTS post_replies;

DROP INDEX IF EXISTS posts_by_time;
DROP INDEX IF EXISTS posts_by_author;
DROP TABLE IF EXISTS posts;
