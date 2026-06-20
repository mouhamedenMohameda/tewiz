-- Widen admin_audit_log.target_id from UUID to TEXT.
--
-- Until 0020 every audited entity (captain applications, application
-- documents, top-ups, voice rides, users, …) was keyed by a UUID, so the
-- column type was a safe constraint. The restaurants module introduced in
-- 0020 keys rows by a human-readable slug (e.g. 'pizza-lina') so the audit
-- INSERT now fails with "invalid input syntax for type uuid".
--
-- Switching to TEXT is non-destructive (every existing UUID renders as its
-- canonical 36-char string) and removes a constraint that was never load-
-- bearing: target_type already disambiguates the kind of ID stored.

ALTER TABLE admin_audit_log
  ALTER COLUMN target_id TYPE text USING target_id::text;

-- Index is rebuilt on column-type change; recreate explicitly to be safe.
DROP INDEX IF EXISTS audit_log_target_idx;
CREATE INDEX audit_log_target_idx
  ON admin_audit_log(target_type, target_id);
