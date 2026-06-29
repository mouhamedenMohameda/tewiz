-- Feature flag: show the one-tap reviewer / demonstration login buttons on the
-- welcome and login screens of the mobile app.
--
-- Default is FALSE so that the buttons are hidden on every existing build and
-- on every new build until you explicitly enable them. The intended workflow:
--
--   Before App Store / Google Play submission:
--     PUT /admin/settings { "showDemoButtons": true }
--
--   After the build is approved:
--     PUT /admin/settings { "showDemoButtons": false }
--
-- No redeploy required — the mobile app reads GET /public/config on launch and
-- caches the value; toggling the column takes effect within 30 s (the
-- app_settings server-side cache TTL).

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS show_demo_buttons boolean NOT NULL DEFAULT false;

COMMIT;
