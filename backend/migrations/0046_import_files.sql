-- contract: only new tables, nothing the previous version reads or writes
-- An uploaded export file (decision 0119): the upload, what the parse found, and
-- the person's choice at publish. The bytes are in the media bucket under
-- `imports/<import_id>`; both go when the import is published, removed or expires.
CREATE TABLE import_files (
  import_id TEXT PRIMARY KEY REFERENCES import_sources (import_id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('uploading', 'parsing', 'ready', 'publishing', 'done', 'failed')),
  -- Why a parse failed: a code, never a text from the file.
  failure TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- What the parse found.
  posts INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  videos INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  earliest INTEGER,
  latest INTEGER,
  -- The choice at publish: a range of dates and a JSON array of item ids left out.
  from_at INTEGER,
  to_at INTEGER,
  excluded TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE INDEX import_files_by_expiry ON import_files (expires_at);

CREATE TABLE import_file_parts (
  import_id TEXT NOT NULL REFERENCES import_files (import_id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY (import_id, part_number)
) STRICT;

-- One row per post found in the file, for the person to preview and choose from.
CREATE TABLE import_file_items (
  import_id TEXT NOT NULL REFERENCES import_files (import_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  -- A JSON array of the image paths in the ZIP.
  images TEXT NOT NULL,
  has_video INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, item_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX import_file_items_by_date ON import_file_items (import_id, at, item_id);
