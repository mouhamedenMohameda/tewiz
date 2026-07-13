-- Hosted Android app builds (APK) uploaded from the admin back-office.
--
-- Until now the "latest build" was just an external URL typed into the admin
-- Settings screen (migration 0059, latest_android_url). This table lets a
-- super_admin UPLOAD the APK itself: the binary is stored by the storage
-- provider (local disk under UPLOAD_DIR, key `releases/<id>.apk`) and the
-- public download page + endpoint serve the most recent row.
--
-- version_name / version_code / package_name are extracted automatically from
-- the APK's AndroidManifest at upload time (no manual entry), so they always
-- match the actual binary a user downloads.
--
-- The row is the source of truth; the download endpoint streams the file at
-- storage_key. Old rows are kept as history (rollback / audit) — "latest" is
-- simply the newest created_at.

BEGIN;

CREATE TABLE IF NOT EXISTS app_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Only Android for now; column keeps the door open for iOS/other later.
  platform      text NOT NULL DEFAULT 'android' CHECK (platform = 'android'),
  -- AndroidManifest versionName, e.g. "1.2.0" — shown to users.
  version_name  text NOT NULL,
  -- AndroidManifest versionCode (monotonic integer Play uses to order builds).
  version_code  bigint NOT NULL,
  -- applicationId, e.g. "com.tewiz.app". Informational.
  package_name  text,
  -- Key in the storage provider (releases/<id>.apk).
  storage_key   text NOT NULL,
  size_bytes    bigint NOT NULL,
  -- Optional release notes shown on the public download page.
  notes         text,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The public "latest" lookup and the admin history list both sort on this.
CREATE INDEX IF NOT EXISTS app_releases_created_idx
  ON app_releases (created_at DESC);

COMMIT;
