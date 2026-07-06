-- Open the roadside "provider" role to ANY user (not just captains).
-- The opt-in used to live on the captains table (0051); move it to a
-- role-agnostic roadside_providers table keyed by user_id so riders can also
-- offer assistance. Declines now reference users (a provider may be a rider).

BEGIN;

CREATE TABLE roadside_providers (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT true,
  specialties text[]  NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Carry over any captains who already opted in (there are none in practice,
-- but keep it safe/idempotent).
INSERT INTO roadside_providers (user_id, enabled, specialties)
SELECT user_id, offers_roadside, roadside_specialties
  FROM captains WHERE offers_roadside = true
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE captains DROP COLUMN IF EXISTS offers_roadside;
ALTER TABLE captains DROP COLUMN IF EXISTS roadside_specialties;

-- Rebuild declines to reference users (empty table — safe to drop/recreate).
DROP TABLE IF EXISTS roadside_declines;
CREATE TABLE roadside_declines (
  request_id  uuid NOT NULL REFERENCES roadside_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, provider_id)
);

COMMIT;
