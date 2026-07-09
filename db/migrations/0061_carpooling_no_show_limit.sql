BEGIN;

-- No-show deterrent for Tfag. A passenger who accumulates at least
-- carpooling_no_show_limit no-shows over the trailing 30 days is temporarily
-- blocked from booking new trips. The window is rolling, so the block clears
-- itself as old no-shows age out — no manual reset needed. 0 disables the
-- deterrent (default at launch).
ALTER TABLE app_settings
  ADD COLUMN carpooling_no_show_limit integer NOT NULL DEFAULT 0;

COMMIT;
