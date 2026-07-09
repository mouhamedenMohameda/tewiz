-- Restaurants: contact phone + multi-photo menu ("carte des plats").
--
-- The admin "Nouveau restaurant" form was simplified to capture only the
-- essentials: French/Arabic name, position, a phone number and a *list* of
-- menu/table photos. Two additions to the schema:
--
--   phone   — contact number shown in the mobile app (call button). Free text
--             so international / local formats both fit.
--   photos  — replaces the single `photo` column for the menu card. The old
--             `photo` column is kept (synced to photos[0] by the API) so any
--             code still reading it — and existing rows — keep working.

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS phone  text,
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}';

-- Backfill photos[] from the legacy single photo so existing menu cards keep
-- showing after the mobile app switches to the array.
UPDATE restaurants
   SET photos = ARRAY[photo]
 WHERE photo IS NOT NULL
   AND cardinality(photos) = 0;

COMMIT;
