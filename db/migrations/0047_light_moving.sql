ALTER TYPE ride_type ADD VALUE 'light_moving';

ALTER TABLE app_settings ADD COLUMN light_moving_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN light_moving_base_fare_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN light_moving_per_km_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN light_moving_min_fare_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN light_moving_commission_bps INTEGER NOT NULL DEFAULT 500;

CREATE TABLE light_moving_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  item_description VARCHAR(500),
  estimated_weight_kg INTEGER
);
