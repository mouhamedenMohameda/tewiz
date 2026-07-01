BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS gps_fraud_severe_mode boolean NOT NULL DEFAULT false;

ALTER TABLE app_settings
  ALTER COLUMN captain_alert_sound_mode SET DEFAULT 'standard';

-- New installs and existing environments should start in non-severe mode.
UPDATE app_settings
   SET captain_alert_sound_mode = 'standard'
 WHERE captain_alert_sound_mode = 'critical';

COMMIT;
