ALTER TYPE ride_type ADD VALUE 'intercity_freight';

ALTER TABLE app_settings ADD COLUMN intercity_freight_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN intercity_freight_base_fare_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN intercity_freight_per_km_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN intercity_freight_min_fare_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN intercity_freight_commission_bps INTEGER NOT NULL DEFAULT 500;

CREATE TABLE intercity_freight_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  cargo_description VARCHAR(500),
  estimated_weight_kg INTEGER,
  special_handling BOOLEAN DEFAULT FALSE
);
