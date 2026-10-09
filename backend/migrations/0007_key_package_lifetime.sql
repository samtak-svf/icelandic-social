-- KeyPackage lifetime (decision 0029): when each package expires, read from
-- its leaf, in milliseconds. A row stored before this has none and counts as
-- created_at plus 84 days.

ALTER TABLE key_packages ADD COLUMN not_after INTEGER;
