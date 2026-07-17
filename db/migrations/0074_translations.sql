-- Editable i18n strings, so a wrong translation can be fixed from the admin
-- without an app rebuild/store review.
--
-- Keys are fixed (dot-notation, mirroring the nested locale JSON files under
-- apps/mobile/locales/*.json, e.g. 'rider.home.title') — the admin only edits
-- values, never adds/removes keys, so a typo can't break a `t('...')` call
-- in the app. Change history lives in the existing admin_audit_log table via
-- the audit() helper, not a bespoke history table.

BEGIN;

CREATE TABLE translations (
  key        TEXT NOT NULL,
  lang       TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (key, lang)
);

CREATE INDEX translations_key_idx ON translations (key);

COMMIT;
