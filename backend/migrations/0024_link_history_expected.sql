-- Whether a history follows a link (decision 0081, #43): the approving phone
-- says so with its approval, and completing the link tells the browser, so it
-- waits for a history only when one is coming.
--
-- Additive, with a default: a phone of 0.37 or earlier sends no such field and
-- always sends a history, so a request approved without it expects one.

ALTER TABLE device_link_requests ADD COLUMN history_expected INTEGER NOT NULL DEFAULT 1;
