-- Editable / deletable notification campaigns + rider targeting.
--
-- The admin can now edit an already-sent campaign (fix a typo, update a promo)
-- or delete it entirely. Editing rewrites the campaign row AND every per-recipient
-- `notifications` row (title/body/data) in place — read state is preserved and no
-- new push is fired, so the correction shows up silently in every inbox on the
-- next poll/refresh. Deleting a campaign relies on the existing
-- `notifications.campaign_id ... ON DELETE CASCADE` to remove it from all inboxes.
--
-- `updated_at` records the last edit so the history can flag "modifié". NULL means
-- the campaign was never edited after its original send.
--
-- No schema change is needed for the new rider targets: `target_type` is free text,
-- so 'all_riders' and 'all_users' are just new values written by the app.

BEGIN;

ALTER TABLE notification_campaigns
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMIT;
