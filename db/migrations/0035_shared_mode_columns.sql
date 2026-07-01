-- Persist pricing mode on rides (solo/shared) for inter-city products.
--
-- Why:
--   We now quote two products for long rides: solo (whole vehicle) and shared
--   (per-seat). Storing the selected mode and seats on each ride keeps audits,
--   analytics, and support screens consistent with what was sold.

BEGIN;

ALTER TABLE rides
  ADD COLUMN pricing_mode text NOT NULL DEFAULT 'solo',
  ADD COLUMN shared_seats integer;

ALTER TABLE rides
  ADD CONSTRAINT rides_pricing_mode_chk
    CHECK (pricing_mode IN ('solo', 'shared')),
  ADD CONSTRAINT rides_shared_seats_chk
    CHECK (shared_seats IS NULL OR shared_seats BETWEEN 2 AND 20),
  ADD CONSTRAINT rides_shared_passenger_only_chk
    CHECK (pricing_mode = 'solo' OR ride_type = 'passenger'),
  ADD CONSTRAINT rides_shared_not_open_chk
    CHECK (pricing_mode = 'solo' OR is_open = false);

CREATE INDEX rides_pricing_mode_idx ON rides (pricing_mode);

COMMIT;
