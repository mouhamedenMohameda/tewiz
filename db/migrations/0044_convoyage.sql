-- Convoyage: captain drives the customer's own car from A to B.
--
-- The rider provides vehicle info (plate, description) and the captain
-- picks up the car at A and delivers it to B. Distance-based pricing
-- with its own tariff grid (base + per-km + minimum).

BEGIN;

ALTER TYPE ride_type ADD VALUE IF NOT EXISTS 'convoyage';

ALTER TABLE app_settings
  ADD COLUMN convoyage_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN convoyage_base_fare_mru  integer NOT NULL DEFAULT 200,
  ADD COLUMN convoyage_per_km_mru     integer NOT NULL DEFAULT 60,
  ADD COLUMN convoyage_min_fare_mru   integer NOT NULL DEFAULT 500,
  ADD COLUMN convoyage_commission_bps integer NOT NULL DEFAULT 1500;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_convoyage_positive CHECK (
    convoyage_base_fare_mru >= 0
    AND convoyage_per_km_mru >= 0
    AND convoyage_min_fare_mru >= 0
    AND convoyage_commission_bps BETWEEN 0 AND 5000
  );

CREATE TABLE convoyage_details (
  ride_id             UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  vehicle_plate       text NOT NULL,
  vehicle_description text NOT NULL DEFAULT ''
);

COMMIT;
