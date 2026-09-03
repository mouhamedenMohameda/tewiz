/**
 * Abonnement Captain — le versant applicatif de la migration 0089.
 *
 * LA RÈGLE, EN UNE PHRASE
 *   Tant que l'abonnement court, le Captain ne paie AUCUNE commission et le
 *   seuil de solde minimum ne lui est plus opposé. C'est tout.
 *
 * TOUT PART D'UNE SEULE QUESTION
 *   « Existe-t-il pour ce Captain une ligne `captain_subscriptions` dont
 *   `ends_at > now()` ? » — `getActiveSubscription()` la pose, et les trois
 *   endroits qui s'en servent (passage en ligne, fin de course, écran mobile)
 *   ne font que lire sa réponse. Aucun état dupliqué sur `captains`, donc rien
 *   qui puisse se désaligner et aucun cron d'expiration à surveiller.
 *
 * L'ACHAT
 *   Un débit du wallet, rien de plus. Le Captain a déjà rechargé son solde par
 *   le flux habituel ; acheter ne fait que déplacer de l'argent qu'il possède
 *   déjà. Débit et reçu sont écrits dans la même transaction : soit les deux,
 *   soit aucun.
 *
 * UN SEUL ABONNEMENT À LA FOIS, SAUF LE DERNIER JOUR
 *   Tant qu'un abonnement court, le Captain ne peut pas en acheter un autre :
 *   l'achat est refusé (409 `subscription_active`). Il ne peut donc pas
 *   empiler des périodes ni immobiliser son solde dans des jours qu'il
 *   n'utilisera que bien plus tard.
 *
 *   L'exception est la dernière journée : dans les 24 h qui précèdent la fin,
 *   le renouvellement est ouvert, et la nouvelle période démarre à la fin de
 *   l'actuelle. Le Captain garde ainsi ses derniers jours payés ET ne subit
 *   aucune coupure de commission entre les deux.
 *
 *   Le cadeau admin (`grantSubscription`) reste, lui, une prolongation sans
 *   condition : c'est un geste commercial, pas un achat.
 *
 * PRIX FIGÉS À L'ACHAT
 *   `days` et `price_mru` sont copiés dans la ligne au moment de l'achat. Si
 *   l'admin change les tarifs demain, les abonnements déjà vendus gardent les
 *   conditions dans lesquelles ils ont été vendus.
 *
 * La Mauritanie est en UTC+0 toute l'année : les dates UTC sont les dates
 * locales.
 */

import type { PoolClient } from 'pg';
import type { SubscriptionPlan } from '@tewiz/shared-types';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { debitWallet, getBalance } from '../wallet/wallet.service.js';

/** Durée de chaque formule, en jours. Le nom de la formule dit déjà tout. */
const PLAN_DAYS: Record<SubscriptionPlan, number> = {
  week: 7,
  month: 30,
};

const DAY_MS = 86_400_000;

/**
 * Fenêtre de renouvellement : le rachat rouvre quand il reste moins que ça.
 * Une journée, parce qu'un Captain qui voit « encore 1 jour » doit pouvoir
 * agir tout de suite plutôt que d'attendre l'expiration pour se réabonner.
 */
const RENEW_WINDOW_MS = DAY_MS;

/** Une formule telle qu'elle est proposée à la vente, prix admin compris. */
export interface SubscriptionPlanOffer {
  plan: SubscriptionPlan;
  days: number;
  priceMru: number;
}

/** L'abonnement en cours d'un Captain. */
export interface ActiveSubscription {
  id: string;
  plan: SubscriptionPlan;
  startsAt: string;
  endsAt: string;
  /** Jours restants, arrondis au jour supérieur — « il vous reste 3 jours ». */
  daysLeft: number;
}

/**
 * Tout ce que l'écran mobile a besoin de savoir, en un seul appel : suis-je
 * abonné, jusqu'à quand, que puis-je acheter et à quel prix, et mon solde
 * suffit-il.
 */
export interface SubscriptionStatus {
  /** L'admin vend-il des abonnements en ce moment ? */
  enabled: boolean;
  /** LA question : la commission est-elle désactivée pour ce Captain ? */
  active: boolean;
  current: ActiveSubscription | null;
  /**
   * Le Captain peut-il acheter en ce moment ? Faux quand un abonnement court
   * encore et qu'on est à plus de 24 h de sa fin — le mobile n'affiche alors
   * aucune formule plutôt qu'un bouton qui ne peut mener qu'à une erreur.
   */
  canPurchase: boolean;
  /** Les formules en vente. Une formule à prix 0 n'y figure pas. */
  plans: SubscriptionPlanOffer[];
  balanceMru: number;
}

/**
 * Le rachat est-il ouvert ? Oui sans abonnement en cours, oui dans les
 * dernières 24 h, non le reste du temps. C'est la seule règle, et les deux
 * endroits qui s'en servent (statut mobile, achat) lisent la même fonction.
 */
function canPurchaseNow(endsAt: Date | null): boolean {
  return endsAt === null || endsAt.getTime() - Date.now() <= RENEW_WINDOW_MS;
}

/** Jours entiers restants avant `endsAt`, au moins 1 tant qu'il reste du temps. */
function daysLeft(endsAt: Date): number {
  return Math.max(1, Math.ceil((endsAt.getTime() - Date.now()) / DAY_MS));
}

interface SubscriptionRow {
  id: string;
  plan: SubscriptionPlan;
  starts_at: Date;
  ends_at: Date;
}

function shape(r: SubscriptionRow): ActiveSubscription {
  return {
    id: r.id,
    plan: r.plan,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    daysLeft: daysLeft(r.ends_at),
  };
}

/**
 * L'abonnement en cours du Captain, ou `null`.
 *
 * C'est LA fonction de tout le module : le passage en ligne et la fin de course
 * ne posent pas d'autre question. Passez `client` pour la lire dans la
 * transaction en cours (fin de course), sinon elle prend une connexion du pool.
 *
 * `ORDER BY ends_at DESC` : si plusieurs lignes se chevauchent (achat pendant
 * un abonnement actif), c'est celle qui va le plus loin qui fait foi.
 */
export async function getActiveSubscription(
  captainId: string,
  client?: PoolClient,
): Promise<ActiveSubscription | null> {
  const runner = client ?? pool;
  const { rows } = await runner.query<SubscriptionRow>(
    `SELECT id, plan, starts_at, ends_at
       FROM captain_subscriptions
      WHERE captain_id = $1 AND ends_at > now()
      ORDER BY ends_at DESC
      LIMIT 1`,
    [captainId],
  );
  return rows[0] ? shape(rows[0]) : null;
}

/**
 * Raccourci booléen — « la commission est-elle désactivée ? ».
 *
 * Une désactivation par l'admin coupe la dispense IMMÉDIATEMENT, comme les
 * jours gratuits (0086) et contrairement au bonus (0028) qui va jusqu'à son
 * terme : c'est l'interrupteur d'urgence. Les abonnements déjà payés ne sont
 * pas effacés pour autant — ils redeviennent actifs si l'admin rallume.
 */
export async function isSubscriptionActive(
  captainId: string,
  client?: PoolClient,
): Promise<boolean> {
  const settings = await getPricingSettings();
  if (!settings.subscriptionEnabled) return false;
  return (await getActiveSubscription(captainId, client)) !== null;
}

/**
 * Les formules en vente, prix admin appliqués.
 *
 * Un prix à 0 signifie « je ne vends pas cette formule » : l'admin retire le
 * forfait semaine ou le forfait mois sans qu'on touche au code.
 */
export async function getPlanOffers(): Promise<SubscriptionPlanOffer[]> {
  const s = await getPricingSettings();
  const prices: Record<SubscriptionPlan, number> = {
    week: s.subscriptionWeekPriceMru,
    month: s.subscriptionMonthPriceMru,
  };
  const all: SubscriptionPlanOffer[] = [
    { plan: 'week', days: PLAN_DAYS.week, priceMru: prices.week },
    { plan: 'month', days: PLAN_DAYS.month, priceMru: prices.month },
  ];
  return all.filter((o) => o.priceMru > 0);
}

/** L'état complet pour l'écran mobile. */
export async function getSubscriptionStatus(captainId: string): Promise<SubscriptionStatus> {
  const settings = await getPricingSettings();
  const [current, plans, balanceMru] = await Promise.all([
    getActiveSubscription(captainId),
    getPlanOffers(),
    getBalance(captainId),
  ]);
  return {
    enabled: settings.subscriptionEnabled,
    active: settings.subscriptionEnabled && current !== null,
    current,
    canPurchase: settings.subscriptionEnabled
      && canPurchaseNow(current ? new Date(current.endsAt) : null),
    plans,
    balanceMru,
  };
}

/**
 * Le Captain achète une formule : débit du wallet + reçu, dans une seule
 * transaction.
 *
 * L'ordre compte :
 *   1. On verrouille le Captain, puis on refuse s'il a un abonnement qui court
 *      encore à plus de 24 h de sa fin. Le verrou fait que deux taps
 *      simultanés ne peuvent pas passer tous les deux : le second lit la ligne
 *      écrite par le premier et repart avec `subscription_active`.
 *   2. On relit le prix depuis les réglages — jamais depuis le corps de la
 *      requête. Le mobile propose, le serveur facture.
 *   3. On débite (le débit refuse tout seul si le solde ne suffit pas).
 *   4. On écrit le reçu. Il démarre à la fin de l'abonnement en cours quand
 *      c'est un renouvellement de dernière minute, sinon maintenant.
 */
export async function purchaseSubscription(
  captainId: string,
  plan: SubscriptionPlan,
): Promise<ActiveSubscription> {
  const settings = await getPricingSettings();
  if (!settings.subscriptionEnabled) {
    throw new HttpError(403, 'subscription_disabled',
      "L'abonnement n'est pas disponible pour le moment.");
  }

  const offer = (await getPlanOffers()).find((o) => o.plan === plan);
  if (!offer) {
    throw new HttpError(400, 'plan_unavailable', "Cette formule n'est pas en vente.");
  }

  return withTx(async (client) => {
    // 1. Sérialise les achats du même Captain, puis refuse s'il est déjà
    //    abonné. Le verrou porte sur la ligne `captains` et non sur les
    //    abonnements : un Captain qui n'en a encore aucun n'a aucune ligne à
    //    verrouiller, et deux taps simultanés passeraient tous les deux. Ici
    //    le second attend, puis relit et voit ce que le premier a inséré.
    await client.query(`SELECT 1 FROM captains WHERE user_id = $1 FOR UPDATE`, [captainId]);

    const { rows: active } = await client.query<{ ends_at: Date }>(
      `SELECT ends_at FROM captain_subscriptions
        WHERE captain_id = $1 AND ends_at > now()
        ORDER BY ends_at DESC
        LIMIT 1`,
      [captainId],
    );
    const currentEnd = active[0]?.ends_at ?? null;
    if (!canPurchaseNow(currentEnd)) {
      const endsAt = currentEnd!;
      throw new HttpError(409, 'subscription_active',
        `Vous avez déjà un abonnement en cours (${daysLeft(endsAt)} jour(s) restants). `
        + "Vous pourrez le renouveler dans les 24 heures qui précèdent sa fin.",
        { endsAt: endsAt.toISOString(), daysLeft: daysLeft(endsAt) });
    }

    // 2. Solde. On vérifie avant de débiter pour renvoyer une erreur que le
    //    mobile sait transformer en « Rechargez d'abord votre wallet ».
    const balance = await getBalance(captainId, client);
    if (balance < offer.priceMru) {
      throw new HttpError(402, 'insufficient_balance',
        `Solde insuffisant : ${offer.priceMru} MRU nécessaires, ${balance} MRU disponibles.`,
        { balanceMru: balance, priceMru: offer.priceMru });
    }

    // 3. Débit.
    const debit = await debitWallet({
      captainId,
      amountMru: offer.priceMru,
      type: 'subscription',
      reason: `Abonnement ${plan === 'week' ? 'semaine' : 'mois'} (${offer.days} jours)`,
    }, client);

    // 4. Reçu. `GREATEST(now(), fin de l'abonnement en cours)` est ce qui fait
    //    qu'un renouvellement de dernière minute se colle au reliquat au lieu
    //    de l'effacer. Sans abonnement en cours, la période part de maintenant.
    const { rows } = await client.query<SubscriptionRow>(
      `INSERT INTO captain_subscriptions
         (captain_id, plan, days, price_mru, starts_at, ends_at, source, wallet_tx_id)
       SELECT $1, $2, $3, $4, start_at, start_at + make_interval(days => $3), 'captain', $5
         FROM (SELECT GREATEST(now(), COALESCE($6::timestamptz, now())) AS start_at) s
       RETURNING id, plan, starts_at, ends_at`,
      [captainId, plan, offer.days, offer.priceMru, debit.transactionId, currentEnd],
    );
    return shape(rows[0]!);
  });
}

/**
 * L'admin offre des jours d'abonnement. Aucun débit : c'est un cadeau.
 *
 * Prolonge de la même façon qu'un achat, pour que « offrir 7 jours » veuille
 * dire sept jours de plus, pas sept jours à la place de ce qui restait.
 */
export async function grantSubscription(
  captainId: string,
  days: number,
  adminUserId: string,
): Promise<ActiveSubscription> {
  if (!Number.isInteger(days) || days <= 0) {
    throw new HttpError(400, 'invalid_days', 'Le nombre de jours doit être un entier positif.');
  }
  const { rows } = await pool.query<SubscriptionRow>(
    `INSERT INTO captain_subscriptions
       (captain_id, plan, days, price_mru, starts_at, ends_at, source, created_by)
     SELECT $1, $2, $3, 0, start_at, start_at + make_interval(days => $3), 'admin', $4
       FROM (
         SELECT COALESCE(
           (SELECT MAX(ends_at) FROM captain_subscriptions
             WHERE captain_id = $1 AND ends_at > now()),
           now()
         ) AS start_at
       ) s
     RETURNING id, plan, starts_at, ends_at`,
    // Un cadeau est étiqueté par la formule dont il a la durée ; au-delà de 7
    // jours c'est un « mois », en dessous une « semaine ». L'étiquette ne sert
    // qu'à l'affichage — la durée réellement accordée est dans `days`.
    [captainId, days > 7 ? 'month' : 'week', days, adminUserId],
  );
  return shape(rows[0]!);
}

/** Historique des achats d'un Captain, le plus récent d'abord (écran admin). */
export async function listSubscriptions(captainId: string, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, plan, days, price_mru, starts_at, ends_at, source, created_at
       FROM captain_subscriptions
      WHERE captain_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [captainId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    plan: r.plan as SubscriptionPlan,
    days: r.days,
    priceMru: Number(r.price_mru),
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    source: r.source as 'captain' | 'admin',
    createdAt: r.created_at.toISOString(),
  }));
}
