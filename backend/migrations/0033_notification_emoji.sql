-- A reaction notification carries the emoji (decision 0100): the one the
-- account first reacted with, since a notification is one per account and post.
-- Null on every other kind and on a notification made before.
ALTER TABLE notifications ADD COLUMN emoji TEXT;
