-- Inter-city pricing model (solo + shared seats).
--
-- Why:
--   Long rides priced with a flat per-km tariff can become too expensive for
--   riders and still not feel fair for captains. We add a dedicated tiered
--   tariff for passenger rides above the existing long-distance threshold, plus
--   an optional shared-seat quote mode.
--
-- Defaults are calibrated so an estimated 1200 km inter-city solo ride is
-- around 20 000 MRU, with a 7% commission.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN intercity_pricing_enabled           boolean NOT NULL DEFAULT true,
  ADD COLUMN intercity_base_fare_mru             integer NOT NULL DEFAULT 100,
  ADD COLUMN intercity_tier1_limit_km            integer NOT NULL DEFAULT 80,
  ADD COLUMN intercity_tier2_limit_km            integer NOT NULL DEFAULT 300,
  ADD COLUMN intercity_tier1_per_km_mru          integer NOT NULL DEFAULT 30,
  ADD COLUMN intercity_tier2_per_km_mru          integer NOT NULL DEFAULT 18,
  ADD COLUMN intercity_tier3_per_km_mru          integer NOT NULL DEFAULT 16,
  ADD COLUMN intercity_shared_default_seats      integer NOT NULL DEFAULT 12,
  ADD COLUMN intercity_shared_min_seat_fare_mru  integer NOT NULL DEFAULT 300,
  ADD COLUMN intercity_commission_bps            integer NOT NULL DEFAULT 700;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_intercity_positive_amounts
    CHECK (
      intercity_base_fare_mru >= 0
      AND intercity_tier1_per_km_mru >= 0
      AND intercity_tier2_per_km_mru >= 0
      AND intercity_tier3_per_km_mru >= 0
      AND intercity_shared_min_seat_fare_mru >= 0
    ),
  ADD CONSTRAINT app_settings_intercity_tier_limits
    CHECK (
      intercity_tier1_limit_km >= 1
      AND intercity_tier2_limit_km > intercity_tier1_limit_km
    ),
  ADD CONSTRAINT app_settings_intercity_shared_seats_bounds
    CHECK (intercity_shared_default_seats BETWEEN 2 AND 20),
  ADD CONSTRAINT app_settings_intercity_commission_bounds
    CHECK (intercity_commission_bps BETWEEN 0 AND 5000);

COMMIT;
