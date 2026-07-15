-- Captain WhatsApp number.
--
-- Why:
--   The captain onboarding is being trimmed to "5 photos + a WhatsApp number"
--   (see 0073). The applicant no longer types their identity/vehicle details —
--   the admin reads those off the uploaded papers. The one datum the captain
--   still provides by hand is how support/ops reaches them: a WhatsApp number.
--
-- Shape:
--   - captain_applications.whatsapp : captured by the applicant, editable while
--     the dossier is a draft / needs correction.
--   - captains.whatsapp             : copied over on approval so an approved
--     captain's contact is queryable without joining back to the application.
--
-- Backfill:
--   Existing approved captains never gave a separate WhatsApp number. Their
--   login phone is, in practice, their WhatsApp in Mauritania — so we seed it
--   from users.phone. Nobody has to re-submit anything.

BEGIN;

ALTER TABLE captain_applications ADD COLUMN IF NOT EXISTS whatsapp CITEXT;
ALTER TABLE captains             ADD COLUMN IF NOT EXISTS whatsapp TEXT;

UPDATE captains c
   SET whatsapp = u.phone
  FROM users u
 WHERE u.id = c.user_id
   AND c.whatsapp IS NULL;

COMMIT;
