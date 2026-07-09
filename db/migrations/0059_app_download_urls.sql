-- Public download links for the latest mobile builds, surfaced at the bottom of
-- the in-app Settings screen ("Télécharger l'application" → Android / iOS
-- buttons). Managed from the admin Settings screen so the store / APK URLs can
-- be updated without a redeploy.
--
-- NULL = no link configured for that platform, in which case the mobile app
-- hides the corresponding button.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS latest_android_url text,
  ADD COLUMN IF NOT EXISTS latest_ios_url     text;

COMMIT;
