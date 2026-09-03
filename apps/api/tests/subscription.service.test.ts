/**
 * Abonnement Captain (migration 0089).
 *
 * L'abonnement touche directement à l'argent : tant qu'il court, la plateforme
 * ne prélève plus rien. Les garanties qui protègent les deux parties sont donc
 * vérifiées ici plutôt que supposées :
 *
 *   1. Le serveur facture SON prix, jamais celui envoyé par le mobile.
 *   2. Une formule à prix 0 n'est pas en vente — et ne peut pas être achetée.
 *   3. Acheter pendant un abonnement en cours PROLONGE : le Captain ne perd
 *      jamais des jours qu'il a déjà payés.
 *   4. Un solde insuffisant refuse l'achat AVANT de toucher au wallet.
 *   5. L'interrupteur admin coupe la dispense immédiatement, sans effacer les
 *      abonnements déjà payés.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, withTxMock, getPricingSettingsMock, debitMock, balanceMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  getPricingSettingsMock: vi.fn(),
  debitMock: vi.fn(),
  balanceMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: getPricingSettingsMock,
}));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({
  debitWallet: debitMock,
  getBalance: balanceMock,
}));

import {
  getActiveSubscription,
  getPlanOffers,
  isSubscriptionActive,
  purchaseSubscription,
} from '../src/modules/captain/subscription.service.js';

const CAPTAIN = 'captain-1';
const DAY_MS = 86_400_000;

/** Les réglages admin par défaut : abonnement ouvert, 1500 / 5000. */
function settings(over: Record<string, unknown> = {}) {
  getPricingSettingsMock.mockResolvedValue({
    subscriptionEnabled: true,
    subscriptionWeekPriceMru: 1500,
    subscriptionMonthPriceMru: 5000,
    ...over,
  });
}

/**
 * Un faux `captain_subscriptions` qui n'implémente que ce dont le service se
 * sert : le verrou sur la ligne `captains`, la lecture de l'abonnement en
 * cours, et l'INSERT. `existingEnd` est ce que la table contient avant l'achat.
 */
function fakeClient(existingEnd: Date | null) {
  const inserted: Array<{ plan: string; days: number; price: number; startsAt: Date; endsAt: Date }> = [];
  const active = existingEnd && existingEnd > new Date() ? existingEnd : null;
  const client = {
    inserted,
    query: vi.fn(async (sql: unknown, p: any[] = []) => {
      const text = String(sql);

      if (/FROM captains WHERE user_id/i.test(text)) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }

      if (/SELECT ends_at FROM captain_subscriptions/i.test(text)) {
        return active
          ? { rows: [{ ends_at: active }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (/SELECT id, plan, starts_at, ends_at/i.test(text)) {
        return active
          ? { rows: [{ id: 'sub-old', plan: 'week', starts_at: new Date(0), ends_at: active }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (/INSERT INTO captain_subscriptions/i.test(text)) {
        const [, plan, days, price, , startParam] = p;
        // GREATEST(now(), $6) : un renouvellement de dernière minute se colle
        // au reliquat, un premier achat part de maintenant.
        const startsAt = startParam && startParam > new Date() ? startParam : new Date();
        const endsAt = new Date(startsAt.getTime() + days * DAY_MS);
        inserted.push({ plan, days, price: Number(price), startsAt, endsAt });
        return { rows: [{ id: 'sub-new', plan, starts_at: startsAt, ends_at: endsAt }], rowCount: 1 };
      }

      throw new Error(`SQL inattendu: ${text.slice(0, 80)}`);
    }),
  };
  return client;
}

beforeEach(() => {
  poolQueryMock.mockReset();
  withTxMock.mockReset();
  getPricingSettingsMock.mockReset();
  debitMock.mockReset();
  balanceMock.mockReset();
  settings();
  debitMock.mockResolvedValue({ transactionId: 'tx-1', balanceAfter: 0 });
});

describe('les formules en vente', () => {
  it('propose la semaine et le mois aux prix fixés par l\'admin', async () => {
    expect(await getPlanOffers()).toEqual([
      { plan: 'week', days: 7, priceMru: 1500 },
      { plan: 'month', days: 30, priceMru: 5000 },
    ]);
  });

  it('retire de la vente toute formule dont le prix est à 0', async () => {
    settings({ subscriptionWeekPriceMru: 0 });
    expect(await getPlanOffers()).toEqual([{ plan: 'month', days: 30, priceMru: 5000 }]);
  });

  it('refuse d\'acheter une formule qui n\'est pas en vente', async () => {
    settings({ subscriptionWeekPriceMru: 0 });
    await expect(purchaseSubscription(CAPTAIN, 'week')).rejects.toMatchObject({ code: 'plan_unavailable' });
    expect(debitMock).not.toHaveBeenCalled();
  });

  it('refuse tout achat quand l\'admin a désactivé l\'abonnement', async () => {
    settings({ subscriptionEnabled: false });
    await expect(purchaseSubscription(CAPTAIN, 'month')).rejects.toMatchObject({ code: 'subscription_disabled' });
    expect(debitMock).not.toHaveBeenCalled();
  });
});

describe('l\'achat', () => {
  /** Fait tourner `purchaseSubscription` sur un faux client de transaction. */
  async function buy(plan: 'week' | 'month', existingEnd: Date | null, balance: number) {
    const client = fakeClient(existingEnd);
    withTxMock.mockImplementation((fn: any) => fn(client));
    balanceMock.mockResolvedValue(balance);
    const result = await purchaseSubscription(CAPTAIN, plan);
    return { client, result };
  }

  it('débite le prix du serveur, pas un montant venu du mobile', async () => {
    const { result } = await buy('week', null, 10_000);
    expect(debitMock).toHaveBeenCalledWith(
      expect.objectContaining({ captainId: CAPTAIN, amountMru: 1500, type: 'subscription' }),
      expect.anything(),
    );
    expect(result.plan).toBe('week');
  });

  it('fige la durée et le prix dans le reçu', async () => {
    const { client } = await buy('month', null, 10_000);
    expect(client.inserted[0]).toMatchObject({ plan: 'month', days: 30, price: 5000 });
  });

  it('refuse un second abonnement tant qu\'il reste plus de 24 h', async () => {
    // Il reste 3 jours : rien n'est en vente, et le wallet n'est pas touché.
    const client = fakeClient(new Date(Date.now() + 3 * DAY_MS));
    withTxMock.mockImplementation((fn: any) => fn(client));
    balanceMock.mockResolvedValue(10_000);
    await expect(purchaseSubscription(CAPTAIN, 'week'))
      .rejects.toMatchObject({ code: 'subscription_active' });
    expect(debitMock).not.toHaveBeenCalled();
    expect(client.inserted).toHaveLength(0);
  });

  it('laisse renouveler dans les dernières 24 h, en gardant le reliquat', async () => {
    // Il reste 6 heures ; acheter une semaine doit mener à 6 h + 7 jours.
    const inSixHours = new Date(Date.now() + DAY_MS / 4);
    const { result } = await buy('week', inSixHours, 10_000);
    const daysFromNow = (new Date(result.endsAt).getTime() - Date.now()) / DAY_MS;
    expect(daysFromNow).toBeGreaterThan(7.2);
    expect(daysFromNow).toBeLessThan(7.3);
  });

  it('laisse racheter une fois l\'abonnement précédent expiré', async () => {
    const yesterday = new Date(Date.now() - DAY_MS);
    const { result } = await buy('week', yesterday, 10_000);
    const daysFromNow = (new Date(result.endsAt).getTime() - Date.now()) / DAY_MS;
    expect(daysFromNow).toBeGreaterThan(6.9);
    expect(daysFromNow).toBeLessThan(7.1);
  });

  it('refuse et ne touche pas au wallet quand le solde ne suffit pas', async () => {
    const client = fakeClient(null);
    withTxMock.mockImplementation((fn: any) => fn(client));
    balanceMock.mockResolvedValue(1499);
    await expect(purchaseSubscription(CAPTAIN, 'week'))
      .rejects.toMatchObject({ code: 'insufficient_balance' });
    expect(debitMock).not.toHaveBeenCalled();
    expect(client.inserted).toHaveLength(0);
  });

  it('lit le solde DANS la transaction qui va le débiter', async () => {
    const { client } = await buy('week', null, 10_000);
    // Sans le client, la lecture partirait sur une autre connexion et ne
    // verrait pas ce que la transaction en cours a déjà écrit.
    expect(balanceMock).toHaveBeenCalledWith(CAPTAIN, client);
  });
});

describe('la dispense de commission', () => {
  /** Ce que la table renvoie pour « l'abonnement en cours de ce Captain ». */
  function currentRow(endsAt: Date | null) {
    poolQueryMock.mockResolvedValue(
      endsAt
        ? { rows: [{ id: 'sub-1', plan: 'month', starts_at: new Date(0), ends_at: endsAt }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
  }

  it('est accordée tant qu\'un abonnement court', async () => {
    currentRow(new Date(Date.now() + 5 * DAY_MS));
    expect(await isSubscriptionActive(CAPTAIN)).toBe(true);
  });

  it('n\'est pas accordée sans abonnement', async () => {
    currentRow(null);
    expect(await isSubscriptionActive(CAPTAIN)).toBe(false);
  });

  it('est coupée immédiatement quand l\'admin désactive la fonctionnalité', async () => {
    settings({ subscriptionEnabled: false });
    currentRow(new Date(Date.now() + 5 * DAY_MS));
    // La ligne payée existe toujours — elle reprendra effet si l'admin
    // réactive. Seule la dispense s'arrête.
    expect(await isSubscriptionActive(CAPTAIN)).toBe(false);
    expect(await getActiveSubscription(CAPTAIN)).not.toBeNull();
  });

  it('annonce des jours restants arrondis au jour supérieur', async () => {
    // 2 jours et demi restants doivent s'afficher « 3 jours », jamais « 2 ».
    currentRow(new Date(Date.now() + 2.5 * DAY_MS));
    expect((await getActiveSubscription(CAPTAIN))!.daysLeft).toBe(3);
  });
});
