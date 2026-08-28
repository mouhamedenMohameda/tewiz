-- Captain "free days" — N randomly-drawn days per ISO week during which the
-- captain keeps 100% of the fare (commission = 0 on rides).
--
-- WHY SERVER-SIDE
--   The whole rule lives in the API: the draw, the storage and the commission
--   waiver all happen at ride completion, inside the same transaction as the
--   wallet debit. Nothing is computed on the device, so captains running an
--   old build get their free days exactly like everybody else.
--
-- THE DRAW (see free-days.service.ts)
--   For each captain and each ISO week (Monday-based) we draw
--   `free_days_per_week` distinct dates, under two constraints:
--     1. No repeat week-over-week — a captain who had Tuesday free last week
--        cannot draw Tuesday again this week. Keeps the perk unpredictable
--        and un-gameable.
--     2. Load spreading — among the eligible weekdays the draw prefers those
--        with the fewest captains already assigned that week, so the whole
--        fleet never lands on the same free day and wipes out a day of
--        commission at once. Ties are broken randomly.
--   Both constraints are relaxed (in that order) only when they would make
--   the draw impossible.
--
-- IMMUTABILITY
--   Once a week is drawn for a captain, its rows are never re-rolled — the
--   PRIMARY KEY makes the insert idempotent, so a concurrent completion or a
--   replayed cron pass can never hand out a second set of free days.
--
-- TIMEZONE
--   Mauritania is UTC+0 all year, so `current_date` / UTC dates are the local
--   calendar day. `free_date` is a plain DATE for that reason.

BEGIN;

-- ── 1. Admin knobs on app_settings ───────────────────────────────────────────

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS free_days_enabled   boolean NOT NULL DEFAULT false,
  -- 0 disables the draw without disabling the feature flag (useful to pause
  -- new grants while already-drawn days still honour their waiver).
  ADD COLUMN IF NOT EXISTS free_days_per_week  integer NOT NULL DEFAULT 1;

ALTER TABLE app_settings
  DROP CONSTRAINT IF EXISTS app_settings_free_days_per_week_range;
ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_free_days_per_week_range
    CHECK (free_days_per_week >= 0 AND free_days_per_week <= 7);

-- ── 2. Drawn free days ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS captain_free_days (
  captain_id  uuid        NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  free_date   date        NOT NULL,
  -- Monday of the ISO week `free_date` belongs to. Denormalised so both the
  -- "already drawn for this week?" check and the per-week load counting are
  -- single indexed lookups instead of date arithmetic on every row.
  week_start  date        NOT NULL,
  -- 'auto'  → drawn by the weekly job / lazy draw
  -- 'admin' → granted by hand from the admin panel
  source      text        NOT NULL DEFAULT 'auto',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (captain_id, free_date)
);

-- "Which days did this captain get this week (and last week)?"
CREATE INDEX IF NOT EXISTS captain_free_days_captain_week_idx
  ON captain_free_days(captain_id, week_start);

-- "How many captains are already free on each day of this week?" — powers the
-- load-spreading half of the draw.
CREATE INDEX IF NOT EXISTS captain_free_days_week_date_idx
  ON captain_free_days(week_start, free_date);

-- ── 3. Per-ride audit flag ───────────────────────────────────────────────────
--
-- Mirrors commission_bonus_applied (migration 0028) so the admin ride detail
-- and any revenue report can tell a 0-commission ride apart from a ride that
-- simply had a 0% rate.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS commission_free_day boolean NOT NULL DEFAULT false;

COMMIT;
