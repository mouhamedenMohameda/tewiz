-- Up Migration
-- API keys + usage log for the Voice-to-Location API (apps/voice-location-api).
-- Self-contained: lives in the same DB as the main API but with its own prefix
-- so it can be split out into a separate database later without touching app code.

CREATE TABLE IF NOT EXISTS voiceloc_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name     text NOT NULL,
  -- Plaintext key prefix shown to humans for identification (e.g. "vl_live_a1b2")
  key_prefix      text NOT NULL,
  -- SHA-256 hash of the full key. Plaintext never stored.
  key_hash        text NOT NULL UNIQUE,
  -- Monthly request quota. 0 = unlimited.
  monthly_quota   integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS voiceloc_api_keys_prefix_idx ON voiceloc_api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS voiceloc_usage_logs (
  id              bigserial PRIMARY KEY,
  api_key_id      uuid NOT NULL REFERENCES voiceloc_api_keys(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  endpoint        text NOT NULL,
  status_code     integer NOT NULL,
  duration_ms     integer,
  audio_bytes     integer,
  transcript_chars integer,
  detected_lang   text,
  geocode_status  text,
  error_message   text
);

CREATE INDEX IF NOT EXISTS voiceloc_usage_logs_key_time_idx
  ON voiceloc_usage_logs(api_key_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS voiceloc_usage_logs;
DROP TABLE IF EXISTS voiceloc_api_keys;
