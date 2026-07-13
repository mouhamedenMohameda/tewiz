-- Captain-reported background-location permission state.
--
-- The off-ride tracker (migration 0066) only runs when the captain grants the
-- "Always"/background location permission. When they decline, tracking stays
-- silently off — and the back-office couldn't tell that apart from a captain
-- who simply isn't moving. The mobile app now reports its permission state when
-- going online / resuming, and we store it here so ops can see WHO to nudge.
--
--   track_perm = 'granted'  → Always/background location on, tracking can run
--   track_perm = 'denied'   → captain declined; no trail will ever appear
--   track_perm =  NULL      → unknown (old app build that never reported)

BEGIN;

ALTER TABLE captain_state
  ADD COLUMN IF NOT EXISTS track_perm    text,
  ADD COLUMN IF NOT EXISTS track_perm_at timestamptz;

-- Keep the value set closed.
ALTER TABLE captain_state
  DROP CONSTRAINT IF EXISTS captain_state_track_perm_chk;
ALTER TABLE captain_state
  ADD CONSTRAINT captain_state_track_perm_chk
  CHECK (track_perm IS NULL OR track_perm IN ('granted', 'denied'));

COMMIT;
