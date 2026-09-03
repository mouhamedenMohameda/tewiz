-- Les documents ne bloquent plus rien après l'acceptation.
--
-- Ce que la 0087 avait mal jugé :
--   Elle déplaçait l'assurance et la photo de la voiture en 'online', et le NNI
--   en 'payout' — en présentant ça comme « la même exigence, plus tard ». C'est
--   faux sur les deux plans.
--
--   1. Pour les captains DÉJÀ acceptés, ce n'était pas « plus tard », c'était
--      « maintenant, rétroactivement ». Un captain qui roulait la veille se
--      retrouvait bloqué hors ligne parce qu'une pièce jamais exigée de lui
--      (ou approuvée il y a un an, ou périmée) manquait soudain à l'appel.
--      L'ancien système ne revérifiait rien après l'approbation : ce verrou
--      était donc une régression pure, pas un renforcement.
--
--   2. L'étape 'payout' gardait le NNI en otage d'un premier retrait. Il n'y a
--      pas de retrait : le portefeuille est en entrée seule (recharges + débit
--      de la commission/abonnement), aucune route ne sort d'argent. On
--      réclamait une pièce d'identité pour débloquer une fonctionnalité qui
--      n'existe pas.
--
-- Ce qu'on garde :
--   Le MÉCANISME reste — 'online' existe toujours et les ops peuvent y placer
--   une pièce depuis /settings/documents s'ils décident un jour d'exiger une
--   assurance valide pour rouler. C'est la POLITIQUE PAR DÉFAUT qui change :
--   plus rien ne bloque, et ces documents restent déposables et consultables.
--   Collecter une information n'oblige pas à barrer la route.
--
-- 'payout' disparaît en revanche du domaine : décrire une étape qui référence
--   une fonctionnalité inexistante ne fait qu'égarer l'opérateur devant le
--   menu déroulant.

BEGIN;

UPDATE document_requirements
   SET stage = 'off', updated_at = now()
 WHERE stage IN ('online', 'payout');

ALTER TABLE document_requirements
  DROP CONSTRAINT document_requirements_stage_check;

ALTER TABLE document_requirements
  ADD CONSTRAINT document_requirements_stage_check
  CHECK (stage IN ('application', 'online', 'off'));

COMMIT;
