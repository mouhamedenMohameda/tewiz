-- Captain location freshness — the signal dispatch trusts.
--
-- Problem this fixes:
--   The push/inbox dispatch filters captains by ST_DWithin(captain_state.location,
--   pickup, 3km). But captain_state.location only changes at go-online and on
--   background-tracking updates (which fire on MOVEMENT). A captain who went
--   online in city A, then travelled to city B without the tracker refreshing,
--   keeps city A's stored location — so he receives A's rides (irrelevant) and
--   misses B's (relevant). `updated_at` can't tell us the LOCATION is fresh
--   because it's bumped by unrelated activity (heartbeat, inbox polling, etc.).
--
-- Fix: a dedicated timestamp set ONLY when the stored position is actually
--   (re)written. Dispatch can then ignore captains whose position is stale.
--   Backfilled from updated_at so already-online captains aren't dropped on
--   deploy; the app refreshes it within a minute via periodic tracking.

BEGIN;

ALTER TABLE captain_state
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

UPDATE captain_state
   SET location_updated_at = updated_at
 WHERE location_updated_at IS NULL
   AND location IS NOT NULL;

COMMIT;
