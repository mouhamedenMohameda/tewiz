-- Partner program: delivery agencies, restaurants and individual members
-- earn a share of OUR platform commission (never of the fare), with a
-- written, certain end condition per partner type.
--
-- Strategy 1 (agencies): each courier recruited by an agency opens a
--   per-courier "earning window" — the agency earns its share on that
--   courier's completed rides for `window_months` months OR until his first
--   `window_max_courses` completed rides, whichever comes first. ONE window
--   per courier FOR LIFE (UNIQUE captain_id) so agencies can't re-register
--   the same courier to reopen a window. A small closure bonus is paid when
--   a window ends in good standing.
--
-- Strategy 1bis (restaurants): the restaurant books rides for its phone-in
--   customers from its own account and earns a share on each completed ride
--   it created. No end window — the work (creating rides) is continuous and
--   extinction is natural: once the end customer orders from the app
--   himself, the ride no longer goes through the restaurant.
--
-- Strategy 2 (individual members): same creation-side share, but capped at
--   `quota_courses` completed rides OR `quota_months` months (first
--   reached). A fixed conversion bonus is paid when one of "their" customers
--   installs the app and completes a first self-ordered ride.
--
-- Money: integer MRU (migration 0017 removed khoums). Rates: basis points.

BEGIN;

-- ─── 1. Partners ────────────────────────────────────────────────────────────
-- Contract terms are snapshotted PER partner (each deal can differ); the
-- app_settings partner_defaults JSON only pre-fills the admin creation form.

CREATE TABLE partners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('agency', 'restaurant', 'individual')),
  name            text NOT NULL,
  phone           citext,
  -- Short human code, typed by couriers at signup or shared with the
  -- partner (e.g. 'AGX-04'). Case-insensitive unique.
  code            citext NOT NULL UNIQUE,
  -- Login account of the partner (restaurant/member who creates rides, or
  -- the agency director's dashboard account). Rides booked by this user are
  -- automatically attributed to the partner.
  user_id         uuid REFERENCES users(id),
  -- Editorial directory entry shown in the rider app (type='restaurant').
  restaurant_id   text REFERENCES restaurants(id),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'ended')),

  -- Share of the platform commission on each attributed ride.
  share_bps       integer NOT NULL CHECK (share_bps BETWEEN 0 AND 5000),

  -- Agency terms: per-courier earning window.
  window_months       integer NOT NULL DEFAULT 12 CHECK (window_months > 0),
  window_max_courses  integer NOT NULL DEFAULT 300 CHECK (window_max_courses > 0),
  closure_bonus_mru   bigint  NOT NULL DEFAULT 0 CHECK (closure_bonus_mru >= 0),

  -- Individual-member terms: creation-side quota + conversion bonus.
  quota_courses        integer NOT NULL DEFAULT 100 CHECK (quota_courses > 0),
  quota_months         integer NOT NULL DEFAULT 6 CHECK (quota_months > 0),
  conversion_bonus_mru bigint  NOT NULL DEFAULT 0 CHECK (conversion_bonus_mru >= 0),

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A login account maps to at most one partner (the /partner/* dashboard
-- resolves the partner from the JWT user).
CREATE UNIQUE INDEX partners_user_id_uidx ON partners(user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX partners_type_status_idx ON partners(type, status);

-- ─── 2. Courier ↔ agency earning window ─────────────────────────────────────
-- PRIMARY KEY captain_id = ONE window per courier FOR LIFE. This is the
-- anti-abuse guarantee: deleting/re-registering the courier cannot reopen a
-- window because the row (keyed on the captain's user id, itself tied to his
-- phone + NNI through KYC) survives or conflicts.

CREATE TABLE captain_partner_links (
  captain_id          uuid PRIMARY KEY REFERENCES captains(user_id),
  partner_id          uuid NOT NULL REFERENCES partners(id),
  attached_at         timestamptz NOT NULL DEFAULT now(),
  -- attached_at + partner.window_months, FROZEN at creation so a later
  -- contract change never silently extends live windows.
  expires_at          timestamptz NOT NULL,
  courses_counted     integer NOT NULL DEFAULT 0 CHECK (courses_counted >= 0),
  closed_at           timestamptz,
  closure_bonus_paid  boolean NOT NULL DEFAULT false
);

CREATE INDEX captain_partner_links_partner_idx ON captain_partner_links(partner_id);

-- ─── 3. Rides: creation-side attribution ────────────────────────────────────

ALTER TABLE rides
  ADD COLUMN origin_partner_id uuid REFERENCES partners(id);

CREATE INDEX rides_origin_partner_idx ON rides(origin_partner_id)
  WHERE origin_partner_id IS NOT NULL;

-- source gains 'restaurant' (restaurant account) and 'partner' (individual
-- member). Extends migration 0023 — same column, wider CHECK.
ALTER TABLE rides DROP CONSTRAINT rides_source_chk;
ALTER TABLE rides
  ADD CONSTRAINT rides_source_chk
  CHECK (source IN ('app', 'operator', 'restaurant', 'partner'));

-- ─── 4. Earnings ledger — the source of truth for partner money ────────────

CREATE TABLE partner_earnings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id),
  ride_id             uuid NOT NULL REFERENCES rides(id),
  role                text NOT NULL CHECK (role IN
                        ('ride_creator', 'captain_provider',
                         'closure_bonus', 'conversion_bonus')),
  -- Snapshot of the platform commission the share was computed from, and of
  -- the EFFECTIVE share applied (may be scaled down by the global cap).
  base_commission_mru bigint  NOT NULL DEFAULT 0 CHECK (base_commission_mru >= 0),
  share_bps           integer NOT NULL DEFAULT 0 CHECK (share_bps >= 0),
  amount_mru          bigint  NOT NULL CHECK (amount_mru >= 0),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'on_hold', 'settled', 'cancelled')),
  -- Which fraud signal froze this line (status='on_hold'). Kept after an
  -- admin releases the hold, as an audit trail.
  hold_reason         text,
  settlement_id       uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotence: replaying a ride completion can never credit twice.
ALTER TABLE partner_earnings
  ADD CONSTRAINT partner_earnings_ride_partner_role_uniq
  UNIQUE (ride_id, partner_id, role);

CREATE INDEX partner_earnings_partner_time_idx
  ON partner_earnings(partner_id, created_at DESC);
CREATE INDEX partner_earnings_status_idx
  ON partner_earnings(status) WHERE status IN ('pending', 'on_hold');

-- ─── 5. Monthly settlements ─────────────────────────────────────────────────

CREATE TABLE partner_settlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partners(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  total_mru     bigint NOT NULL DEFAULT 0 CHECK (total_mru >= 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  paid_at       timestamptz,
  paid_by       uuid REFERENCES users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE INDEX partner_settlements_partner_idx
  ON partner_settlements(partner_id, period_start DESC);

ALTER TABLE partner_earnings
  ADD CONSTRAINT partner_earnings_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES partner_settlements(id);

-- ─── 6. Beneficiaries (strategy 2 conversion bonus) ─────────────────────────
-- Phone UNIQUE: an end customer belongs to the FIRST member who served him.

CREATE TABLE partner_beneficiaries (
  partner_id          uuid NOT NULL REFERENCES partners(id),
  phone               citext PRIMARY KEY,
  first_served_at     timestamptz NOT NULL DEFAULT now(),
  converted_at        timestamptz,
  conversion_ride_id  uuid REFERENCES rides(id)
);

CREATE INDEX partner_beneficiaries_partner_idx ON partner_beneficiaries(partner_id);

-- ─── 7. Courier signup: optional agency code, snapshotted on the KYC file ───
-- Validated at submission; the captain_partner_links row is created at
-- approval (when the captains row exists).

ALTER TABLE captain_applications
  ADD COLUMN agency_code citext;

-- ─── 8. Global settings ─────────────────────────────────────────────────────
--   * partner_total_share_cap_bps: the SUM of shares paid on one ride
--     (creation side + captain side) never exceeds this fraction of the
--     platform commission; both lines are scaled down proportionally.
--   * restaurant_*/partner_* commission rates: platform commission applied
--     to rides created by those sources, same model as operator_* (0022).
--     Seeded from the current standard rates so behaviour is unchanged
--     until the admin tunes them.
--   * fraud thresholds for the periodic scan job.
--   * partner_defaults: JSON used to pre-fill terms in the admin form.

ALTER TABLE app_settings
  ADD COLUMN partner_total_share_cap_bps          integer NOT NULL DEFAULT 5000,
  ADD COLUMN restaurant_passenger_commission_bps  integer NOT NULL DEFAULT 700,
  ADD COLUMN restaurant_colis_commission_bps      integer NOT NULL DEFAULT 1000,
  ADD COLUMN partner_passenger_commission_bps     integer NOT NULL DEFAULT 700,
  ADD COLUMN partner_colis_commission_bps         integer NOT NULL DEFAULT 1000,
  ADD COLUMN partner_fraud_pair_max_rides_7d      integer NOT NULL DEFAULT 8,
  ADD COLUMN partner_fraud_min_distance_m         integer NOT NULL DEFAULT 300,
  ADD COLUMN partner_fraud_max_creations_per_hour integer NOT NULL DEFAULT 6,
  ADD COLUMN partner_defaults                     jsonb;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_partner_share_cap_bounds
    CHECK (partner_total_share_cap_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT app_settings_partner_commissions_bounds
    CHECK (restaurant_passenger_commission_bps BETWEEN 0 AND 5000
       AND restaurant_colis_commission_bps     BETWEEN 0 AND 5000
       AND partner_passenger_commission_bps    BETWEEN 0 AND 5000
       AND partner_colis_commission_bps        BETWEEN 0 AND 5000),
  ADD CONSTRAINT app_settings_partner_fraud_bounds
    CHECK (partner_fraud_pair_max_rides_7d > 0
       AND partner_fraud_min_distance_m >= 0
       AND partner_fraud_max_creations_per_hour > 0);

UPDATE app_settings
   SET restaurant_passenger_commission_bps = default_commission_bps,
       restaurant_colis_commission_bps     = colis_commission_bps,
       partner_passenger_commission_bps    = default_commission_bps,
       partner_colis_commission_bps        = colis_commission_bps
 WHERE id = 1;

COMMIT;
