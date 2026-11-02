-- contract: import_file_items is rebuilt with the same columns, only to widen its class check, so the previous version reads it unchanged
-- Photos outside the posts file come in as kinds of their own (decision 0127). SQLite cannot widen a
-- check, so the table is rebuilt; only preview rows live in it and nothing references it.
CREATE TABLE import_file_items_new (
  import_id TEXT NOT NULL REFERENCES import_files (import_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  -- A JSON array of the image paths in the ZIP.
  images TEXT NOT NULL,
  has_video INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  link TEXT,
  class TEXT NOT NULL DEFAULT 'own'
    CHECK (class IN ('own', 'link', 'other_timeline', 'hidden', 'album', 'profile', 'uncategorized')),
  images_lost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, item_id)
) STRICT, WITHOUT ROWID;
INSERT INTO import_file_items_new (import_id, item_id, at, body, images, has_video, published, link, class, images_lost)
  SELECT import_id, item_id, at, body, images, has_video, published, link, class, images_lost FROM import_file_items;
DROP TABLE import_file_items;
ALTER TABLE import_file_items_new RENAME TO import_file_items;
CREATE INDEX import_file_items_by_date ON import_file_items (import_id, at, item_id);
