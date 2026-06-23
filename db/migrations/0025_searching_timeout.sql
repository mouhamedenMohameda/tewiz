-- Configurable timeout: a ride that sits in 'searching' for longer than this
-- is auto-cancelled by the system so the booker isn't left hanging.
--
-- Why:
--   When no captain accepts a ride, today it stays 'searching' forever. The
--   booker has no signal that no one is coming, and the admin dashboard fills
--   up with phantom rides. A background job (apps/api/src/modules/rides/
--   expiry.service.ts) reads this setting every 30 s and cancels stale rides.
--
-- Shape:
--   searching_timeout_s: default 600 (10 minutes). 0 disables auto-cancel,
--   for testing or for a temporary off-switch.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN searching_timeout_s integer NOT NULL DEFAULT 600;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_searching_timeout_positive
    CHECK (searching_timeout_s >= 0);

COMMIT;
