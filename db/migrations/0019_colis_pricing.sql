-- Separate pricing knobs for colis (package delivery) vs passenger rides.
--
-- Why:
--   Operators reported that colis runs are cheaper to perform than passenger
--   rides (no rider in the car, often shorter, captain can chain several),
--   so charging the same per-km / base fare as a passenger ride overprices
--   the service. Until now `app_settings` only carried one tariff that was
--   applied to both ride types — only the commission was differentiated.
--
-- Shape:
--   Three new integer columns mirroring the passenger trio. All MRU.
--   Defaults are intentionally lower than the passenger defaults so that an
--   operator who hasn't touched the new fields still sees colis priced
--   below passengers:
--     - colis_base_fare_mru = 15  (vs passenger 20)
--     - colis_per_km_mru    = 12  (vs passenger 30)
--     - colis_min_fare_mru  = 15  (vs passenger 40)
--
-- Behaviour:
--   - estimateFareMru() in apps/api picks the colis trio when rideType='colis'
--     and the passenger trio otherwise.
--   - Existing rides keep their stored fare_estimate_mru. Only NEW bookings
--     read the latest settings (same rule as 0018).

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN colis_base_fare_mru integer NOT NULL DEFAULT 15,
  ADD COLUMN colis_per_km_mru    integer NOT NULL DEFAULT 12,
  ADD COLUMN colis_min_fare_mru  integer NOT NULL DEFAULT 15;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_colis_positive_amounts CHECK (
    colis_base_fare_mru >= 0
    AND colis_per_km_mru >= 0
    AND colis_min_fare_mru >= 0
  );

COMMIT;
