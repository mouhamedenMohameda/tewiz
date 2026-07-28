-- Captain terms & conditions acceptance log.
--
-- A captain must accept the current T&C version before their application can
-- be submitted (server-side gate in submitApplication), and already-approved
-- captains are blocked by a full-screen gate until they accept.
--
-- One row per (user, version): re-accepting the same version is idempotent,
-- while publishing a NEW version simply makes every existing row stale, which
-- re-triggers the gate for everyone. Old rows are kept forever — they are the
-- legal proof of what was accepted, when, in which language and from which
-- app build.

BEGIN;

CREATE TABLE captain_terms_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  -- Language the captain actually read the terms in ('ar' | 'fr').
  locale        TEXT NOT NULL,
  -- Client build that collected the consent, for audit purposes.
  app_version   TEXT,
  platform      TEXT,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, terms_version)
);

CREATE INDEX captain_terms_acceptances_user_idx
  ON captain_terms_acceptances (user_id);

COMMIT;
