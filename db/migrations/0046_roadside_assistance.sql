ALTER TYPE ride_type ADD VALUE 'roadside_assistance';

ALTER TABLE app_settings ADD COLUMN roadside_assistance_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN roadside_assistance_base_fare_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN roadside_assistance_commission_bps INTEGER NOT NULL DEFAULT 500;

CREATE TABLE roadside_assistance_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  assistance_type VARCHAR(100) NOT NULL,
  vehicle_condition VARCHAR(500)
);
