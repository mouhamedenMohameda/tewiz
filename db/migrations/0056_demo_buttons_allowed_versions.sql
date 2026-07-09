-- Which app version(s) are allowed to see the reviewer demo-login buttons, on
-- top of the show_demo_buttons master toggle. Comma-separated list of version
-- strings (as sent by the mobile app in the X-App-Version header), e.g.
-- '1.1.12' or '1.1.12,1.1.13'.
--
-- This replaces the DEMO_BUTTONS_ALLOWED_VERSIONS env var so the value can be
-- managed from the admin Settings screen (no redeploy / no shell access). The
-- gating stays: buttons show only when show_demo_buttons is true AND the
-- caller's version is in this list. Older / already-shipped builds send no
-- version header and are never matched, so enabling the toggle for a store
-- review can't leak the buttons to real users on other versions.
--
-- Default '1.1.12' matches the build currently submitted for review.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS demo_buttons_allowed_versions text NOT NULL DEFAULT '1.1.12';

COMMIT;
