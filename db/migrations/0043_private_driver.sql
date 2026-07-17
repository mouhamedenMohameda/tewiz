-- Private Driver (Captain Privé): hourly booking of a captain.
--
-- The rider books a captain for a fixed number of hours (3, 6, 12, or 24)
-- at a flat hourly rate. No destination required. At completion the fare is
-- max(booked_duration, actual_duration) × hourly_rate — the rider always
-- pays for the reserved time, plus any overtime.

BEGIN;

ALTER TYPE ride_type ADD VALUE IF NOT EXISTS 'private_driver';

ALTER TABLE app_settings
  ADD COLUMN private_driver_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN private_driver_hourly_rate_mru integer NOT NULL DEFAULT 500,
  ADD COLUMN private_driver_min_hours       integer NOT NULL DEFAULT 3,
  ADD COLUMN private_driver_commission_bps  integer NOT NULL DEFAULT 1000;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_private_driver_positive CHECK (
    private_driver_hourly_rate_mru >= 0
    AND private_driver_min_hours >= 1
    AND private_driver_commission_bps BETWEEN 0 AND 5000
  );

CREATE TABLE private_driver_details (
  ride_id           UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  booked_duration_h integer NOT NULL CHECK (booked_duration_h > 0),
  hourly_rate_mru   integer NOT NULL CHECK (hourly_rate_mru >= 0),
  booked_fare_mru   integer NOT NULL CHECK (booked_fare_mru >= 0)
);

COMMIT;
