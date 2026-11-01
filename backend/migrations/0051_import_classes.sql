-- contract: new columns with defaults, so the previous version of the Worker reads and writes as before. Files read before this have no classes: those still waiting for a choice end as outdated.
-- What an export holds (decision 0127). Each preview row says what kind of post it is and
-- how many of its images will not arrive; the file keeps the tally per class, what did not
-- become a row at all, and which classes the person chose at publish.
ALTER TABLE import_file_items ADD COLUMN class TEXT NOT NULL DEFAULT 'own'
  CHECK (class IN ('own', 'link', 'other_timeline', 'hidden'));
ALTER TABLE import_file_items ADD COLUMN images_lost INTEGER NOT NULL DEFAULT 0;

ALTER TABLE import_files ADD COLUMN classes TEXT NOT NULL DEFAULT '{}';
ALTER TABLE import_files ADD COLUMN lost TEXT NOT NULL DEFAULT '{}';
ALTER TABLE import_files ADD COLUMN chosen_classes TEXT NOT NULL DEFAULT '["own"]';

-- An export file read before classes counted another person's images as the reader's.
UPDATE import_files SET state = 'failed', failure = 'outdated'
 WHERE state = 'ready'
   AND import_id IN (SELECT import_id FROM import_sources WHERE kind = 'file');

-- A connection's preview holds only the person's own posts: its rows default to own.
UPDATE import_files
   SET classes = json_object('own', json_object(
         'posts', posts, 'images', images, 'imagesLost', 0, 'videos', videos))
 WHERE state = 'ready';
