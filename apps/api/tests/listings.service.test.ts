import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSql, rows } from './helpers/db.js';

// Service-listings marketplace. publishListing runs in withTx and debits the
// wallet; the rest use pool.query. We fake the tx client, mock debitWallet and
// notifications, and route pool.query by SQL regex.

const { queryMock, debitWalletMock, sendNotificationMock, fakeClient, state } = vi.hoisted(() => {
  const state = {
    clientQueries: [] as string[],
    clientResponder: (_sql: string) => ({ rows: [] as any[], rowCount: 0 }),
  };
  const fakeClient = {
    query: vi.fn(async (sql: string) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.clientResponder(sql);
    }),
    release: vi.fn(),
  };
  return {
    queryMock: vi.fn(),
    debitWalletMock: vi.fn(async () => {}),
    sendNotificationMock: vi.fn(async () => {}),
    fakeClient,
    state,
  };
});

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
  withTx: async (fn: (c: typeof fakeClient) => Promise<unknown>) => {
    await fakeClient.query('BEGIN');
    try {
      const r = await fn(fakeClient);
      await fakeClient.query('COMMIT');
      return r;
    } catch (e) {
      await fakeClient.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      fakeClient.release();
    }
  },
}));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({ debitWallet: debitWalletMock }));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ sendNotification: sendNotificationMock }));

import {
  publishListing,
  listListings,
  revealProviderContact,
  cancelMyListing,
  updateCategory,
  expireListings,
  getAdminStats,
} from '../src/modules/listings/listings.service.js';

const CATEGORY_RE = /FROM listing_categories WHERE category/;
const USER_RE = /FROM users WHERE id/;
const WALLET_RE = /FROM wallets WHERE captain_id/;
const INSERT_RE = /INSERT INTO service_listings/;

const insertedRow = {
  id: 'l-1',
  provider_id: 'cap-1',
  category: 'plomberie',
  title: 'Plombier',
  description: null,
  price_mru: 5000,
  price_unit: 'fixed',
  provider_phone: '22200',
  publication_fee_mru: 200,
  window_days: 30,
  published_until: new Date('2026-08-01T00:00:00.000Z'),
  views_count: 0,
  status: 'active',
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  provider_name: 'Cheikh',
};

const baseInput = {
  category: 'plomberie',
  title: '  Plombier  ',
  priceMru: 5000,
  priceUnit: 'fixed' as const,
  windowDays: 30,
};

function catRow(over: Record<string, unknown> = {}) {
  return { category: 'plomberie', label: 'Plomberie', enabled: true, publication_fee_mru: 200, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.clientQueries = [];
  state.clientResponder = () => ({ rows: [], rowCount: 0 });
});

describe('publishListing — validation gates', () => {
  it('400 invalid_category when the category does not exist', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([])]]);
    await expect(publishListing('cap-1', baseInput)).rejects.toMatchObject({ status: 400, code: 'invalid_category' });
  });

  it('403 category_disabled when the category is turned off', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow({ enabled: false })])]]);
    await expect(publishListing('cap-1', baseInput)).rejects.toMatchObject({ status: 403, code: 'category_disabled' });
  });

  it('403 captain_only when the publisher is not a captain', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow()])]]);
    state.clientResponder = (sql) =>
      USER_RE.test(sql) ? { rows: [{ role: 'rider', phone: '22200', full_name: 'X' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(publishListing('cap-1', baseInput)).rejects.toMatchObject({ status: 403, code: 'captain_only' });
    expect(state.clientQueries).toContain('ROLLBACK');
  });

  it('400 provider_phone_required when neither override nor account phone exists', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow()])]]);
    state.clientResponder = (sql) =>
      USER_RE.test(sql) ? { rows: [{ role: 'captain', phone: null, full_name: 'X' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(publishListing('cap-1', baseInput)).rejects.toMatchObject({ status: 400, code: 'provider_phone_required' });
  });

  it('402 insufficient_wallet when the balance is below the fee', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow({ publication_fee_mru: 200 })])]]);
    state.clientResponder = (sql) => {
      if (USER_RE.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'X' }], rowCount: 1 };
      if (WALLET_RE.test(sql)) return { rows: [{ balance_mru: '50' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await expect(publishListing('cap-1', baseInput)).rejects.toMatchObject({ status: 402, code: 'insufficient_wallet' });
    expect(debitWalletMock).not.toHaveBeenCalled();
    expect(state.clientQueries).toContain('ROLLBACK');
  });
});

describe('publishListing — success', () => {
  it('debits the fee, inserts, and returns the detail (fee > 0)', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow({ publication_fee_mru: 200 })])]]);
    state.clientResponder = (sql) => {
      if (USER_RE.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'Cheikh' }], rowCount: 1 };
      if (WALLET_RE.test(sql)) return { rows: [{ balance_mru: '1000' }], rowCount: 1 };
      if (INSERT_RE.test(sql)) return { rows: [insertedRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };

    const detail = await publishListing('cap-1', baseInput);

    expect(debitWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({ captainId: 'cap-1', amountMru: 200, type: 'listing_publication' }),
      fakeClient,
    );
    expect(state.clientQueries).toContain('COMMIT');
    expect(detail.id).toBe('l-1');
    expect(detail.providerPhone).toBe('22200');
    expect(detail.title).toBe('Plombier');
  });

  it('skips the wallet entirely when the fee is 0', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow({ publication_fee_mru: 0 })])]]);
    state.clientResponder = (sql) => {
      if (USER_RE.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'Cheikh' }], rowCount: 1 };
      if (INSERT_RE.test(sql)) return { rows: [{ ...insertedRow, publication_fee_mru: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };

    await publishListing('cap-1', baseInput);

    expect(debitWalletMock).not.toHaveBeenCalled();
    expect(state.clientQueries.some((q) => WALLET_RE.test(q))).toBe(false);
    expect(state.clientQueries).toContain('COMMIT');
  });

  it('prefers the explicit providerPhone override over the account phone', async () => {
    dispatchSql(queryMock, [[CATEGORY_RE, rows([catRow({ publication_fee_mru: 0 })])]]);
    let insertParams: any[] = [];
    fakeClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      if (USER_RE.test(sql)) return { rows: [{ role: 'captain', phone: '11111', full_name: 'C' }], rowCount: 1 };
      if (INSERT_RE.test(sql)) { insertParams = params!; return { rows: [{ ...insertedRow, provider_phone: '99999' }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });

    await publishListing('cap-1', { ...baseInput, providerPhone: '  99999  ' });
    // $7 is provider_phone.
    expect(insertParams[6]).toBe('99999');
  });
});

describe('listListings — dynamic filters', () => {
  it('always filters active + unexpired and appends provided filters in order', async () => {
    dispatchSql(queryMock, [[/FROM service_listings l/, rows([])]]);
    await listListings({ category: 'plomberie', excludeProviderId: 'me', search: '  fuite ' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/l\.status = 'active'/);
    expect(sql).toMatch(/l\.published_until > now\(\)/);
    expect(sql).toMatch(/l\.category = \$1/);
    expect(sql).toMatch(/l\.provider_id <> \$2/);
    expect(sql).toMatch(/title ILIKE \$3 OR l\.description ILIKE \$3/);
    expect(params).toEqual(['plomberie', 'me', '%fuite%']);
  });
});

describe('revealProviderContact', () => {
  const okRow = {
    provider_id: 'cap-1',
    provider_phone: '22200',
    provider_name: 'Cheikh',
    title: 'Plombier',
    status: 'active',
    published_until: new Date(Date.now() + 86_400_000),
  };

  it('404s when the listing does not exist', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings l/, rows([])]]);
    await expect(revealProviderContact('l-1', 'viewer')).rejects.toMatchObject({ status: 404, code: 'listing_not_found' });
  });

  it('410s when the listing is expired', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings l/, rows([{ ...okRow, published_until: new Date(Date.now() - 1000) }])]]);
    await expect(revealProviderContact('l-1', 'viewer')).rejects.toMatchObject({ status: 410, code: 'listing_inactive' });
  });

  it('reveals contact and notifies the provider for a third-party viewer', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings l/, rows([okRow])]]);
    const res = await revealProviderContact('l-1', 'viewer-2');
    expect(res).toEqual({ providerPhone: '22200', providerName: 'Cheikh' });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'user', userId: 'cap-1' } }),
    );
  });

  it('does NOT notify when the provider views their own listing', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings l/, rows([okRow])]]);
    await revealProviderContact('l-1', 'cap-1');
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

describe('cancelMyListing / expireListings / updateCategory / getAdminStats', () => {
  it('cancelMyListing maps rowCount to boolean', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings/, { rows: [], rowCount: 1 }]]);
    expect(await cancelMyListing('l-1', 'cap-1')).toBe(true);
  });

  it('expireListings returns 0 when rowCount is null', async () => {
    dispatchSql(queryMock, [[/UPDATE service_listings/, { rows: [] }]]);
    expect(await expireListings()).toBe(0);
  });

  it('updateCategory 404s when the category does not exist', async () => {
    dispatchSql(queryMock, [[/UPDATE listing_categories/, rows([])]]);
    await expect(updateCategory('ghost', { enabled: true })).rejects.toMatchObject({ status: 404, code: 'category_not_found' });
  });

  it('getAdminStats coerces text aggregates to numbers', async () => {
    dispatchSql(queryMock, [[/FROM service_listings/, rows([{
      total_listings: '12', active_listings: '5', total_revenue_mru: '2400', avg_views: '3.5',
    }])]]);
    expect(await getAdminStats()).toEqual({
      totalListings: 12,
      activeListings: 5,
      totalRevenueMru: 2400,
      avgViews: 3.5,
    });
  });
});
