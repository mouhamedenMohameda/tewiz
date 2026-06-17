-- Down migration for 0016_guest_users.sql
DROP INDEX IF EXISTS users_guest_idx;
ALTER TABLE users DROP COLUMN IF EXISTS is_guest;
-- Re-applying NOT NULL FAILS if any guest rows with a NULL phone still exist.
-- Delete them first if you really need to roll back:
--   DELETE FROM users WHERE phone IS NULL;
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
