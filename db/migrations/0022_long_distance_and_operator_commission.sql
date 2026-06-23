-- Long-distance threshold + dedicated commission for call-center (operator)
-- rides.
--
-- Why:
--   * The captain UI now exposes a live toggle "I accept inter-city rides".
--     Until now the column captains.accepts_long_distance was stored but
--     never used by the dispatcher. We need a single threshold (in meters)
--     above which a ride is considered "long distance" and only offered to
--     captains who opted in.
--   * Rides created by an admin operator (passenger reached us by phone)
--     consume more of our resources (call-center time, manual entry) than
--     rides created directly in the app. We want to charge a different
--     commission rate for them — without forking the price seen by the
--     passenger or paid to the captain on top of the fare.
--
-- Shape:
--   * long_distance_threshold_m: default 50_000 (50 km). Editable in admin.
--   * operator_*_commission_bps: default to the same value as the regular
--     commission so existing behaviour is unchanged until the admin sets a
--     dedicated rate. Basis points (100 bps = 1 %).

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN long_distance_threshold_m        integer NOT NULL DEFAULT 50000,
  ADD COLUMN operator_passenger_commission_bps integer NOT NULL DEFAULT 700,
  ADD COLUMN operator_colis_commission_bps    integer NOT NULL DEFAULT 1000;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_long_distance_threshold_positive
    CHECK (long_distance_threshold_m > 0),
  ADD CONSTRAINT app_settings_operator_commissions_bounds
    CHECK (operator_passenger_commission_bps BETWEEN 0 AND 5000
       AND operator_colis_commission_bps    BETWEEN 0 AND 5000);

-- Seed operator commissions with the current passenger/colis rates so the
-- behaviour is identical until the admin sets a dedicated value.
UPDATE app_settings
   SET operator_passenger_commission_bps = default_commission_bps,
       operator_colis_commission_bps     = colis_commission_bps
 WHERE id = 1;

COMMIT;
