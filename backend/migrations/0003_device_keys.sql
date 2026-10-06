-- One device per signature key (decision 0014). A device key is also the
-- MLS credential key of every leaf the device holds (decision 0002), so two
-- devices with one key would be two leaves with one identity. The core makes
-- a new key whenever it signs in afresh, revoked devices included, so no
-- honest client ever sends one twice.

CREATE UNIQUE INDEX one_device_per_key ON devices (device_key);
