-- The server's half of a browser's store key exists from the link request on
-- (decision 0096), so a link still waiting for the phone survives a reload of
-- the page sealed in two parts, as a linked browser's store is (0064). Completing
-- the request moves the share to the device. A request made by a version
-- before this one has none, and completing it makes a fresh one.
ALTER TABLE device_link_requests ADD COLUMN store_key_share BLOB;
