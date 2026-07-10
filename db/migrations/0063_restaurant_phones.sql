-- Restaurants: allow several contact phone numbers.
--
-- A restaurant can have more than one number (dine-in, delivery, manager…),
-- so the single `phone` column added in 0062 becomes a list. The old `phone`
-- column is kept (synced to phones[0] by the API) so existing rows and any
-- reader still on the single field keep working — same tactic as photo/photos.

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS phones text[] NOT NULL DEFAULT '{}';

-- Backfill phones[] from the legacy single phone.
UPDATE restaurants
   SET phones = ARRAY[phone]
 WHERE phone IS NOT NULL
   AND cardinality(phones) = 0;

COMMIT;
