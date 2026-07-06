-- Roadside assistance ("Assistance Routière") — an on-demand SOS flow, NOT a
-- classified ad. A stranded driver broadcasts their location + problem; nearby
-- opted-in providers (captains) get a push and the first to accept takes it.
-- Reuses the ride dispatch primitives (captain_state presence/location, push,
-- GPS). If no one accepts within the expanding radius/timeout, the app falls
-- back to a human "numéro vert".

BEGIN;

-- Providers opt in and (optionally) declare specialties. Empty array = accepts
-- every problem type.
ALTER TABLE captains
  ADD COLUMN offers_roadside      boolean NOT NULL DEFAULT false,
  ADD COLUMN roadside_specialties text[]  NOT NULL DEFAULT '{}';

CREATE TABLE roadside_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id   uuid NOT NULL REFERENCES users(id),
  location       geography(Point, 4326) NOT NULL,
  address_label  text,
  problem_type   text NOT NULL
                 CHECK (problem_type IN ('pneu','batterie','essence','moteur','remorquage','accident','autre')),
  note           text,
  photo_url      text,
  status         text NOT NULL DEFAULT 'searching'
                 CHECK (status IN ('searching','accepted','in_progress','completed','cancelled','unresolved')),
  provider_id    uuid REFERENCES users(id),
  provider_phone text,
  requester_phone text,
  search_radius_m integer NOT NULL DEFAULT 5000,
  lead_fee_mru   integer NOT NULL DEFAULT 0,
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_expanded_at timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz,
  completed_at   timestamptz
);

CREATE INDEX roadside_requests_searching_idx
  ON roadside_requests (status, created_at)
  WHERE status = 'searching';

CREATE INDEX roadside_requests_requester_idx ON roadside_requests (requester_id);
CREATE INDEX roadside_requests_provider_idx ON roadside_requests (provider_id);
CREATE INDEX roadside_requests_location_idx ON roadside_requests USING gist (location);

-- A provider who declined a request must never be re-notified for it.
CREATE TABLE roadside_declines (
  request_id  uuid NOT NULL REFERENCES roadside_requests(id) ON DELETE CASCADE,
  captain_id  uuid NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, captain_id)
);

-- Tunables (reuses the existing roadside_assistance_enabled master toggle).
ALTER TABLE app_settings
  ADD COLUMN roadside_initial_radius_m  integer NOT NULL DEFAULT 5000,
  ADD COLUMN roadside_radius_step_m     integer NOT NULL DEFAULT 5000,
  ADD COLUMN roadside_max_radius_m      integer NOT NULL DEFAULT 20000,
  ADD COLUMN roadside_expand_interval_s integer NOT NULL DEFAULT 45,
  ADD COLUMN roadside_request_timeout_s integer NOT NULL DEFAULT 300,
  ADD COLUMN roadside_lead_fee_mru      integer NOT NULL DEFAULT 0,
  ADD COLUMN roadside_hotline_phone     text;

COMMIT;
