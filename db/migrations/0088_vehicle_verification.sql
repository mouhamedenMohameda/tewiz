-- Le véhicule est désormais déclaré par le captain APRÈS son acceptation.
--
-- Pourquoi une vérification :
--   Jusqu'ici la plaque était recopiée par l'opérateur depuis la carte grise
--   qu'il avait sous les yeux : impossible qu'elle diverge du document. Le
--   captain saisissant lui-même ses infos, un écart devient possible — et une
--   plaque qui ne correspond pas à la carte grise déposée est exactement le
--   scénario de fraude que la revue documentaire existe pour attraper.
--
--   D'où ce contrôle : le véhicule déclaré reste non vérifié jusqu'à ce qu'un
--   opérateur l'ait confronté à la carte grise, et un véhicule non vérifié ne
--   peut pas passer en ligne. C'est un coup d'œil (les deux sont côte à côte
--   dans la file /captains/pending-online), pas une enquête.
--
-- Rétro-compatibilité :
--   Les véhicules existants ont été saisis par les ops depuis la carte grise —
--   ils sont vérifiés par construction. On les marque comme tels avec leur
--   date de création, sinon la migration mettrait hors ligne tous les captains
--   actifs. `verified_by` reste NULL : personne n'a cliqué, c'est le système.

BEGIN;

ALTER TABLE vehicles
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE vehicles SET verified_at = created_at WHERE verified_at IS NULL;

-- File d'attente de la revue "mise en ligne" : les véhicules non vérifiés,
-- les plus anciens d'abord.
CREATE INDEX vehicles_pending_verification
  ON vehicles (created_at)
  WHERE verified_at IS NULL AND is_active = true;

COMMIT;
