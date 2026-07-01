BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS captain_alert_sound_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_captain_alert_sound_url_chk'
  ) THEN
    ALTER TABLE app_settings
      ADD CONSTRAINT app_settings_captain_alert_sound_url_chk
      CHECK (
        captain_alert_sound_url IS NULL
        OR captain_alert_sound_url ~ '^https?://'
      );
  END IF;
END $$;

COMMIT;