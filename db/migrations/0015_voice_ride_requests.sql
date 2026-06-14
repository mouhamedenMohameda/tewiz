-- Up Migration
-- Voice-first ride requests (human-in-the-loop).
--
-- This replaces the fully-automated voice→location pipeline
-- (apps/voice-location-api + /rider/voice-to-location) with a flow where a
-- human dispatcher listens to the rider's voice memo and places the ride.
--
-- Flow:
--   1. Rider records a short voice memo ("emmène-moi de X à Y") in the app and
--      uploads the m4a to POST /rider/voice-rides. A row is created here with
--      status 'pending'. The audio is written via the StorageProvider under
--      UPLOAD_DIR/voice-rides/<id>.m4a and referenced by audio_key (a storage
--      key, not an absolute path — same convention as colis_details.*_photo_key).
--   2. An admin sees the pending request (5 s polling) in admin-web, listens to
--      the audio, pins pickup + dropoff on the map (POI search reuses the
--      recycled voiceloc corpus) and confirms. Confirmation creates a real
--      `rides` row and links it back here via ride_id; the chosen Google POIs
--      are silently auto-seeded into voiceloc_pois.
--   3. The rider's app polls GET /rider/voice-rides/:id; on confirmation it
--      receives the linked ride and a push ("Votre course est confirmée").
--   4. While still 'pending', the rider may cancel from the waiting screen.

CREATE TYPE voice_ride_status AS ENUM (
  'pending',     -- waiting for an admin to process
  'confirmed',   -- admin created a ride; see ride_id
  'rejected',    -- admin could not action it (inaudible, out of zone, ...)
  'cancelled'    -- rider cancelled while still pending
);

CREATE TABLE IF NOT EXISTS voice_ride_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who recorded the request.
  user_id            UUID NOT NULL REFERENCES users(id),

  status             voice_ride_status NOT NULL DEFAULT 'pending',

  -- Audio memo. audio_key is the StorageProvider key, e.g. "voice-rides/<id>.m4a".
  audio_key          TEXT NOT NULL,
  audio_mime         TEXT NOT NULL DEFAULT 'audio/m4a',
  audio_duration_s   INT,

  -- Optional transcript. The current flow has the admin listen directly, but
  -- the column is here so a future assist (or the recycled STT) can fill it.
  transcript         TEXT,

  -- Locations the admin pinned while processing. NULL until confirmed.
  -- GEOGRAPHY to match the rides table, into which these are copied on confirm.
  pickup_location    GEOGRAPHY(POINT, 4326),
  pickup_label       TEXT,
  dropoff_location   GEOGRAPHY(POINT, 4326),
  dropoff_label      TEXT,

  -- The ride created when the admin confirms (NULL otherwise).
  ride_id            UUID REFERENCES rides(id) ON DELETE SET NULL,

  -- Admin processing metadata.
  processed_by       UUID REFERENCES users(id),   -- admin who confirmed/rejected
  reject_reason      TEXT,

  -- Lifecycle timestamps.
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,                  -- set on confirm or reject
  cancelled_at       TIMESTAMPTZ
);

-- Admin pending queue: oldest-first FIFO over just the open requests.
CREATE INDEX IF NOT EXISTS voice_ride_requests_pending_idx
  ON voice_ride_requests (created_at)
  WHERE status = 'pending';

-- Rider history / "my requests, newest first".
CREATE INDEX IF NOT EXISTS voice_ride_requests_user_time_idx
  ON voice_ride_requests (user_id, created_at DESC);

-- Reverse lookup ride -> request, and enforce one request per ride.
CREATE UNIQUE INDEX IF NOT EXISTS voice_ride_requests_ride_idx
  ON voice_ride_requests (ride_id)
  WHERE ride_id IS NOT NULL;

-- (Down migration in a separate file: 0015_voice_ride_requests.down.sql)
