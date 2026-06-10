-- Up Migration
-- Closes the voice-to-location loop:
--
--   /voice-to-location → returns a request_id with N candidates per side
--                        → row in voiceloc_requests (TTL 24h)
--   /voice-to-location/confirm {request_id, side, place_id, lat, lng, name}
--                        → row in voiceloc_confirmations
--                        → if confirmed place was sourced from Google,
--                          it is auto-seeded into voiceloc_pois so the
--                          next user saying the same thing is resolved
--                          locally without hitting Google.

CREATE TABLE IF NOT EXISTS voiceloc_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      uuid NOT NULL REFERENCES voiceloc_api_keys(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 24 h after creation, the row is eligible for cleanup (or just for
  -- rejecting late confirmations).
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),

  transcript      text,
  detected_lang   text,
  intent          text,

  -- Full per-side response blocks, stored verbatim so that /confirm can
  -- validate the chosen place_id against what was actually returned.
  pickup          jsonb,
  destination     jsonb
);

CREATE INDEX IF NOT EXISTS voiceloc_requests_key_time_idx
  ON voiceloc_requests (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS voiceloc_requests_expires_idx
  ON voiceloc_requests (expires_at);

CREATE TABLE IF NOT EXISTS voiceloc_confirmations (
  id              bigserial PRIMARY KEY,
  request_id      uuid NOT NULL REFERENCES voiceloc_requests(id) ON DELETE CASCADE,
  side            text NOT NULL CHECK (side IN ('pickup','destination')),

  -- The chosen place: place_id may be 'osm:N', 'ChIJ...' (Google), or
  -- 'manual:N' for seeded entries. Free-text choice (user typed) keeps
  -- place_id NULL and just supplies lat/lng/name.
  chosen_place_id text,
  chosen_lat      double precision NOT NULL,
  chosen_lng      double precision NOT NULL,
  chosen_name     text,

  -- Provenance signal — useful for analytics ("what % of confirms picked
  -- the top candidate?") and to detect bad ranking.
  was_top_candidate boolean,
  candidate_rank    integer,   -- 0 = top, 1 = runner-up, NULL = not in list
  source            text,      -- 'local' | 'google' | 'manual' | 'free_text'

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voiceloc_confirmations_request_idx
  ON voiceloc_confirmations (request_id);

CREATE INDEX IF NOT EXISTS voiceloc_confirmations_place_idx
  ON voiceloc_confirmations (chosen_place_id);

CREATE INDEX IF NOT EXISTS voiceloc_confirmations_time_idx
  ON voiceloc_confirmations (created_at DESC);

-- (Down migration: db/migrations/0013_voiceloc_confirmations.down.sql)
