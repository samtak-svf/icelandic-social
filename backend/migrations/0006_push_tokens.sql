-- Push tokens (decision 0025). Each device registers its own FCM or APNs
-- token; a token is unique across devices, so one that moves to a new
-- registration leaves the old row. Revoking a device clears its token.

ALTER TABLE devices ADD COLUMN push_token TEXT;
-- APNs development environment; ignored on Android.
ALTER TABLE devices ADD COLUMN push_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (push_sandbox IN (0, 1));

CREATE UNIQUE INDEX devices_by_push_token ON devices (push_token);
