-- Down migration for 0014_password_auth.sql
DROP INDEX IF EXISTS login_attempts_recent_idx;
DROP INDEX IF EXISTS login_attempts_phone_time_idx;
DROP TABLE IF EXISTS login_attempts;

ALTER TABLE otp_codes DROP COLUMN IF EXISTS deprecated_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS created_by_admin_id,
  DROP COLUMN IF EXISTS must_reset_password,
  DROP COLUMN IF EXISTS password_updated_at,
  DROP COLUMN IF EXISTS password_hash;
