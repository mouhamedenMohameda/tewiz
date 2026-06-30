-- Add explicit captain vehicle type to dispatch rides correctly.
-- Rule set:
--   - moto captains receive only colis rides
--   - car captains receive passenger rides, and colis only when opted in

CREATE TYPE vehicle_type AS ENUM ('car', 'moto');

ALTER TABLE captain_applications
  ADD COLUMN vehicle_type vehicle_type;

UPDATE captain_applications
   SET vehicle_type = 'car'
 WHERE vehicle_type IS NULL;

ALTER TABLE captain_applications
  ALTER COLUMN vehicle_type SET DEFAULT 'car',
  ALTER COLUMN vehicle_type SET NOT NULL;

ALTER TABLE captains
  ADD COLUMN vehicle_type vehicle_type NOT NULL DEFAULT 'car';

ALTER TABLE vehicles
  ADD COLUMN vehicle_type vehicle_type NOT NULL DEFAULT 'car';

-- A moto captain must always accept colis; passenger ride dispatch is blocked
-- at query level using vehicle_type.
ALTER TABLE captains
  ADD CONSTRAINT captains_moto_colis_chk
  CHECK (vehicle_type <> 'moto' OR accepts_colis = true);
