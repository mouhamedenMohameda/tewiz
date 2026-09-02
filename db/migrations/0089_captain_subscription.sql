-- Abonnement Captain — le Captain paie une fois, roule sans commission.
--
-- L'IDÉE, EN UNE PHRASE
--   Tant que son abonnement est actif, le Captain garde 100% de chaque course :
--   la commission n'est plus prélevée du tout. En échange il paie d'avance un
--   forfait (semaine ou mois) dont le prix est fixé par l'admin.
--
-- POURQUOI SERVEUR
--   Exactement la même règle que les jours gratuits (migration 0086) : l'achat,
--   la date de fin et la dispense de commission vivent dans l'API. Le mobile
--   n'affiche qu'un état, il ne décide jamais rien. Un Captain sur un vieux
--   build est abonné comme les autres.
--
-- CE QUE L'ABONNEMENT DONNE
--   1. Aucune commission sur les courses terminées.
--   2. Le seuil de solde minimum pour passer en ligne est levé — l'abonnement
--      remplace la garantie de solde, puisqu'il n'y a plus rien à prélever.
--   Le reste ne change pas : voir les courses autour, recevoir les alertes et
--   accepter, ce sont déjà les droits d'un Captain en ligne.
--
-- PAIEMENT
--   Aucun nouveau moyen de paiement. Le Captain recharge son wallet avec le
--   flux existant (Bankily / Masrvi / Sedad / bureau + capture validée par
--   l'admin), puis achète l'abonnement : un simple débit du wallet, du type
--   'subscription'. Tout est déjà dans le grand livre, rien à réconcilier.
--
-- PROLONGATION
--   Acheter alors qu'un abonnement court ne le remplace pas : la nouvelle
--   période se colle à la fin de l'actuelle. Le Captain ne perd jamais des
--   jours déjà payés.
--
-- FUSEAU
--   La Mauritanie est en UTC+0 toute l'année : les dates UTC sont les dates
--   locales. `ends_at` est un timestamptz — l'abonnement expire à l'heure
--   exacte, pas à minuit, donc une semaine achetée à 14h dure jusqu'à 14h.

BEGIN;

-- ── 1. Réglages admin ────────────────────────────────────────────────────────
--
-- Trois boutons, comme les jours gratuits : un interrupteur + deux prix.
-- Un prix à 0 masque la formule correspondante (permet de ne vendre que le
-- mois, ou que la semaine, sans toucher au code).

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS subscription_enabled          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_week_price_mru   integer NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS subscription_month_price_mru  integer NOT NULL DEFAULT 5000;

ALTER TABLE app_settings
  DROP CONSTRAINT IF EXISTS app_settings_subscription_prices_positive;
ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_subscription_prices_positive
    CHECK (subscription_week_price_mru >= 0 AND subscription_month_price_mru >= 0);

-- ── 2. Type de mouvement wallet ──────────────────────────────────────────────
--
-- Le débit de l'abonnement a son propre type pour qu'il ne soit jamais confondu
-- avec une commission dans l'historique du Captain ni dans les rapports.

ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'subscription';

-- ── 3. Les abonnements achetés ───────────────────────────────────────────────
--
-- Une ligne par achat, jamais modifiée : c'est un reçu. L'état « abonné ou
-- pas » se lit toujours de la même façon — existe-t-il une ligne dont
-- `ends_at > now()` ? — donc rien à synchroniser, rien à faire expirer par un
-- cron, aucun état qui puisse se désaligner.

CREATE TABLE IF NOT EXISTS captain_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id   uuid        NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  -- 'week' | 'month' — la formule choisie, gardée pour le reçu et les stats.
  plan         text        NOT NULL CHECK (plan IN ('week', 'month')),
  -- Durée réellement accordée, figée à l'achat. Si l'admin change la formule
  -- plus tard, les abonnements déjà vendus ne bougent pas.
  days         integer     NOT NULL CHECK (days > 0),
  -- Prix réellement payé, figé à l'achat pour la même raison.
  price_mru    integer     NOT NULL CHECK (price_mru >= 0),
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  -- 'captain' → acheté depuis l'application (débit wallet)
  -- 'admin'   → offert à la main depuis le panneau admin (aucun débit)
  source       text        NOT NULL DEFAULT 'captain'
                           CHECK (source IN ('captain', 'admin')),
  -- Le mouvement wallet correspondant, NULL pour un cadeau admin.
  wallet_tx_id uuid        REFERENCES wallet_transactions(id),
  created_by   uuid        REFERENCES users(id),   -- admin auteur du cadeau
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- « Ce Captain est-il abonné en ce moment ? » — la seule question posée en
-- boucle (à chaque passage en ligne, à chaque course terminée).
CREATE INDEX IF NOT EXISTS captain_subscriptions_captain_end_idx
  ON captain_subscriptions(captain_id, ends_at DESC);

-- ── 4. Trace par course ──────────────────────────────────────────────────────
--
-- Comme commission_free_day (0086) et commission_bonus_applied (0028) : une
-- course à 0 commission parce que le Captain est abonné doit être
-- reconnaissable d'une course dont le taux était simplement à 0%.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS commission_subscription boolean NOT NULL DEFAULT false;

COMMIT;
