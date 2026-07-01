BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS captain_alert_sound_mode text NOT NULL DEFAULT 'critical',
  ADD COLUMN IF NOT EXISTS captain_alert_repeat_interval_s integer NOT NULL DEFAULT 2;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_captain_alert_sound_mode_chk
  CHECK (captain_alert_sound_mode IN ('standard', 'critical'));

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_captain_alert_repeat_interval_chk
  CHECK (captain_alert_repeat_interval_s BETWEEN 1 AND 15);

COMMIT;