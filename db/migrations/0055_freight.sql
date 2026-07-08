-- Intercity freight ("Fret Intercité") — a freight board (like carpooling, but
-- for goods). A carrier publishes a scheduled trip (city → city, date, capacity
-- in kg, price/kg). A shipper browses trips and requests space for a cargo
-- (description + weight); the carrier confirms/declines within remaining
-- capacity. On confirmation both phone numbers are revealed. No commission.

BEGIN;

CREATE TABLE freight_trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_city      text NOT NULL,
  destination_city text NOT NULL,
  departure_date   date NOT NULL,
  capacity_kg      integer NOT NULL CHECK (capacity_kg > 0),
  price_per_kg_mru integer NOT NULL CHECK (price_per_kg_mru >= 0),
  min_price_mru    integer NOT NULL DEFAULT 0 CHECK (min_price_mru >= 0),
  vehicle_type     text,
  note             text,
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','paused','departed','removed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX freight_trips_browse_idx ON freight_trips (status, departure_date) WHERE status = 'active';
CREATE INDEX freight_trips_carrier_idx ON freight_trips (carrier_id);

CREATE TABLE freight_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL REFERENCES freight_trips(id) ON DELETE CASCADE,
  shipper_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cargo_description text NOT NULL,
  weight_kg         integer NOT NULL CHECK (weight_kg > 0),
  total_mru         integer NOT NULL CHECK (total_mru >= 0),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','declined','cancelled','completed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz
);

CREATE INDEX freight_bookings_trip_idx ON freight_bookings (trip_id, status);
CREATE INDEX freight_bookings_shipper_idx ON freight_bookings (shipper_id);

COMMIT;
