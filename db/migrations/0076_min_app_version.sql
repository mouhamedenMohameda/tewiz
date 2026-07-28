-- Minimum supported app version — the "update required" gate.
--
-- When a build's version (sent in the X-App-Version header / read locally by
-- the client) is LOWER than this value, the app shows a blocking full-screen
-- "please update" screen. NULL (the default) disables the gate entirely.
--
-- IMPORTANT: this only takes effect from the build that ships the gate code
-- onward. A binary that was already installed before the gate existed has no
-- screen to show — there is no way to push new native UI into an old binary.
-- Bumping this value kills every *future* build below it.
--
-- Compared with a simple numeric-dotted-segment order (1.2.10 > 1.2.9), matching
-- the client-side comparator in apps/mobile/lib/appConfig.ts.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS min_android_version text,
  ADD COLUMN IF NOT EXISTS min_ios_version     text;

COMMIT;
