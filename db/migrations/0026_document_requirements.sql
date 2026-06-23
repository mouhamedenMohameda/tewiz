-- Per-document-type "required" flag, editable from the admin panel.
--
-- Why:
--   Until now the admin web hardcoded that all 14 document_type values had to
--   be uploaded and approved before a captain application could be approved.
--   In practice operators want to skip some documents (e.g. visite_technique
--   on brand-new vehicles, or interior photos for an existing captain).
--
-- Shape:
--   One row per enum value of `document_type`. `is_required = true` keeps the
--   old behaviour; `false` lets the approve flow pass even when the document
--   is missing or not approved. Seeded with all types required, which matches
--   the pre-existing implicit policy.
--
-- Behaviour:
--   Read by the admin web (to decide whether to disable the "Approuver"
--   button) and by the backend approve endpoint (to validate that every
--   *required* type is present and approved). Optional types are still
--   uploadable; they are simply ignored by the approval gate.

BEGIN;

CREATE TABLE document_requirements (
  type        document_type PRIMARY KEY,
  is_required boolean       NOT NULL DEFAULT true,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  uuid          REFERENCES users(id) ON DELETE SET NULL
);

-- Seed every enum value as required. New enum values added later must add
-- their own seed row in a follow-up migration.
INSERT INTO document_requirements (type, is_required)
SELECT unnest(enum_range(NULL::document_type)), true;

COMMIT;
