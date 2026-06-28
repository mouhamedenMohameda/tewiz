-- Captain commission bonus + notifications system.
--
-- COMMISSION BONUS
--   When a captain accumulates X MRU of commission paid within Y days, their
--   commission is halved for the next Z days, on every ride type (in-app
--   passenger, in-app colis, operator passenger, operator colis).
--
--   X / Y / Z are global, admin-tunable. During the bonus the counter is
--   frozen (no accumulation) — at bonus expiry the counter resets to 0 and
--   a new window opens on the next commission paid. If the Y-day window
--   elapses without reaching X, counter and window also reset.
--
--   Disabling the feature does NOT terminate an already-active bonus; the
--   captain keeps it until expiry.
--
-- NOTIFICATIONS
--   Generic admin → captain (or admin → user) messaging. Persisted so the
--   mobile app can show an inbox; also pushed via Expo for live alerts.
--   Targets supported by the admin UI:
--     - 'all_captains'   → every captain user
--     - 'group'          → a named cohort (e.g. 'bonus_active')
--     - 'user'           → one specific recipient
--   A single send creates one `notification_campaigns` row plus one
--   `notifications` row per recipient, so each captain marks-as-read
--   independently while the admin still sees one campaign in the history.

BEGIN;

-- ── 1. Bonus config on app_settings ──────────────────────────────────────────

ALTER TABLE app_settings
  ADD COLUMN commission_bonus_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN commission_bonus_threshold_mru  integer NOT NULL DEFAULT 1000,
  ADD COLUMN commission_bonus_window_days    integer NOT NULL DEFAULT 10,
  ADD COLUMN commission_bonus_reward_days    integer NOT NULL DEFAULT 2;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_bonus_positive CHECK (
    commission_bonus_threshold_mru > 0
    AND commission_bonus_window_days > 0
    AND commission_bonus_reward_days > 0
  );

-- ── 2. Bonus state on captains ───────────────────────────────────────────────

ALTER TABLE captains
  ADD COLUMN commission_counter_mru        integer     NOT NULL DEFAULT 0,
  ADD COLUMN commission_window_started_at  timestamptz,
  ADD COLUMN commission_bonus_until        timestamptz;

ALTER TABLE captains
  ADD CONSTRAINT captains_commission_counter_nonneg
    CHECK (commission_counter_mru >= 0);

-- ── 3. Per-ride audit flag ───────────────────────────────────────────────────

ALTER TABLE rides
  ADD COLUMN commission_bonus_applied boolean NOT NULL DEFAULT false;

-- ── 4. Notification campaigns (one row per admin send) ───────────────────────

CREATE TABLE notification_campaigns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      text        NOT NULL,                   -- 'all_captains' | 'group' | 'user'
  target_value     text,                                   -- group name, user id, or NULL
  type             text        NOT NULL DEFAULT 'info',    -- 'info' | 'bonus_config' | 'system'
  title            text        NOT NULL,
  body             text        NOT NULL,
  data             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recipient_count  integer     NOT NULL DEFAULT 0,
  sent_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_campaigns_created_idx
  ON notification_campaigns(created_at DESC);

-- ── 5. Per-recipient inbox rows ──────────────────────────────────────────────

CREATE TABLE notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid        NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
  recipient_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text        NOT NULL DEFAULT 'info',
  title         text        NOT NULL,
  body          text        NOT NULL,
  data          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_idx
  ON notifications(recipient_id, created_at DESC);

CREATE INDEX notifications_recipient_unread_idx
  ON notifications(recipient_id) WHERE read_at IS NULL;

CREATE INDEX notifications_campaign_idx
  ON notifications(campaign_id);

COMMIT;
