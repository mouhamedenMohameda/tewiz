-- Onboarding v3 : le captain ne remplit plus rien avant d'être accepté.
--
-- Pourquoi :
--   La candidature demandait 8 champs saisis à la main (nom + véhicule) et
--   5 documents. Or la plaque, la marque, le modèle, l'année, la couleur, le
--   nombre de places et le nom du propriétaire figurent TOUS sur la carte
--   grise, que le candidat photographie de toute façon. On lui faisait donc
--   recopier ce qu'il était en train de prendre en photo — ~34 taps avant le
--   moindre "oui".
--
--   La 0073 avait déjà réduit les documents de 14 à 5. Cette migration va au
--   bout de la même logique : on ne demande que ce qui permet de décider
--   *maintenant* si la personne peut conduire. Le reste est demandé au
--   captain APRÈS son acceptation, quand il est motivé pour le fournir.
--
-- Le passage de `is_required` (booléen) à `stage` :
--   'application' — bloque l'envoi de la candidature ET sa validation.
--   'online'      — bloque le passage en ligne, pas la validation.
--   'payout'      — bloque le premier retrait du portefeuille.
--   'off'         — uploadable, ne bloque rien (ex-`is_required = false`).
--
--   Un booléen ne pouvait pas exprimer « obligatoire, mais plus tard ». Les
--   ops gardent la main sur la répartition depuis /settings/documents, comme
--   ils l'avaient sur l'ancien interrupteur.
--
-- Déploiement :
--   `is_required` est supprimée ici. L'API doit être déployée avec cette
--   migration (l'ancienne version lit/écrit encore la colonne). Seules des
--   routes admin sont concernées — pas le trafic captain/rider.

BEGIN;

ALTER TABLE document_requirements
  ADD COLUMN stage text NOT NULL DEFAULT 'off'
    CHECK (stage IN ('application', 'online', 'payout', 'off'));

-- Ce qui reste avant le "oui" : le droit de conduire, et le véhicule conduit.
-- La carte grise porte en plus toutes les données véhicule — c'est elle qui
-- remplace le formulaire supprimé côté mobile.
UPDATE document_requirements SET stage = 'application'
 WHERE type IN ('license_front', 'carte_grise');

-- Après le "oui", avant la première course. L'assurance gagne au passage un
-- vrai point de contrôle récurrent : elle était vérifiée une fois à
-- l'inscription puis jamais revue, elle est maintenant revalidée à chaque
-- expiration puisqu'elle conditionne la mise en ligne.
UPDATE document_requirements SET stage = 'online'
 WHERE type IN ('assurance', 'car_front');

-- Conformité / lutte anti-fraude : exigée au premier retrait, pas pour rouler.
UPDATE document_requirements SET stage = 'payout'
 WHERE type IN ('nni_front');

ALTER TABLE document_requirements DROP COLUMN is_required;

COMMIT;
