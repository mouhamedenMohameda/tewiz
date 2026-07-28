import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { HttpError } from '../src/middleware/error.js';

// Boundary tests for both the captain/buyer router and the admin router. Auth
// guards are stubbed to passthrough (role enforcement is covered by the auth
// middleware tests); here we assert validation, envelopes, and the public
// detail's provider-identity stripping.

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    cancelMyListing: vi.fn(),
    getListingById: vi.fn(),
    listCategories: vi.fn(),
    listListings: vi.fn(),
    listMyListings: vi.fn(),
    publishListing: vi.fn(),
    revealProviderContact: vi.fn(),
    getAdminStats: vi.fn(),
    listAdminListings: vi.fn(),
    updateCategory: vi.fn(),
  },
}));

vi.mock('../src/modules/listings/listings.service.js', () => svcMock);
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  optionalAuth: (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

import { listingsRouter } from '../src/modules/listings/listings.routes.js';
import { adminListingsRouter } from '../src/modules/listings/admin-listings.routes.js';

const USER = { id: 'cap-1', role: 'captain' as const };
let app: TestAppHandle;
let admin: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/listings', listingsRouter, USER);
  admin = await startTestApp('/admin/listings', adminListingsRouter, { id: 'admin-1', role: 'admin' });
});
afterEach(async () => {
  await app.close();
  await admin.close();
});

describe('POST /listings', () => {
  it('rejects an unknown category with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/listings', {
      category: 'bogus',
      title: 'Service',
      price_mru: 1000,
      price_unit: 'fixed',
      window_days: 30,
    });
    expect(res.status).toBe(400);
    expect(svcMock.publishListing).not.toHaveBeenCalled();
  });

  it('rejects a window over 90 days with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/listings', {
      category: 'convoyage',
      title: 'Service',
      price_mru: 1000,
      price_unit: 'fixed',
      window_days: 120,
    });
    expect(res.status).toBe(400);
  });

  it('publishes (201) and forwards camelCase input', async () => {
    svcMock.publishListing.mockResolvedValue({ id: 'l-1' });
    const res = await api(app.baseUrl, 'POST', '/listings', {
      category: 'convoyage',
      title: 'Service convoyage',
      price_mru: 1000,
      price_unit: 'per_trip',
      window_days: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ listing: { id: 'l-1' } });
    expect(svcMock.publishListing).toHaveBeenCalledWith('cap-1', expect.objectContaining({
      category: 'convoyage',
      priceMru: 1000,
      priceUnit: 'per_trip',
      windowDays: 30,
    }));
  });

  it('propagates a 402 insufficient_wallet', async () => {
    svcMock.publishListing.mockRejectedValue(new HttpError(402, 'insufficient_wallet', 'x'));
    const res = await api(app.baseUrl, 'POST', '/listings', {
      category: 'convoyage',
      title: 'Service',
      price_mru: 1000,
      price_unit: 'fixed',
      window_days: 30,
    });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('insufficient_wallet');
  });
});

describe('GET /listings/:id — public detail hides provider identity', () => {
  it('strips providerId and providerPhone from the payload', async () => {
    svcMock.getListingById.mockResolvedValue({
      id: 'l-1',
      providerId: 'cap-1',
      providerPhone: '22200',
      title: 'X',
      category: 'convoyage',
    });
    const res = await api(app.baseUrl, 'GET', '/listings/l-1');
    expect(res.status).toBe(200);
    expect(res.body.listing).not.toHaveProperty('providerId');
    expect(res.body.listing).not.toHaveProperty('providerPhone');
    expect(res.body.listing).toMatchObject({ id: 'l-1', title: 'X' });
  });

  it('404s when the listing is missing', async () => {
    svcMock.getListingById.mockResolvedValue(null);
    const res = await api(app.baseUrl, 'GET', '/listings/l-1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('listing_not_found');
  });
});

describe('POST /listings/:id/reveal', () => {
  it('maps the contact to snake_case and propagates a 410 when inactive', async () => {
    svcMock.revealProviderContact.mockResolvedValue({ providerPhone: '22200', providerName: 'Cheikh' });
    const ok = await api(app.baseUrl, 'POST', '/listings/l-1/reveal', {});
    expect(ok.body).toEqual({ provider_phone: '22200', provider_name: 'Cheikh' });

    svcMock.revealProviderContact.mockRejectedValue(new HttpError(410, 'listing_inactive', 'x'));
    const gone = await api(app.baseUrl, 'POST', '/listings/l-2/reveal', {});
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('listing_inactive');
  });
});

describe('DELETE /listings/:id', () => {
  it('404s when the captain owns nothing cancellable', async () => {
    svcMock.cancelMyListing.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'DELETE', '/listings/l-1');
    expect(res.status).toBe(404);
  });
});

describe('GET /listings/categories — only enabled', () => {
  it('asks the service for enabled-only categories', async () => {
    svcMock.listCategories.mockResolvedValue([{ category: 'convoyage' }]);
    const res = await api(app.baseUrl, 'GET', '/listings/categories');
    expect(res.status).toBe(200);
    expect(svcMock.listCategories).toHaveBeenCalledWith(true);
  });
});

describe('admin router', () => {
  it('GET / bundles listings + stats + all categories', async () => {
    svcMock.listAdminListings.mockResolvedValue([{ id: 'l-1' }]);
    svcMock.getAdminStats.mockResolvedValue({ totalListings: 1 });
    svcMock.listCategories.mockResolvedValue([{ category: 'convoyage' }]);
    const res = await api(admin.baseUrl, 'GET', '/admin/listings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      listings: [{ id: 'l-1' }],
      stats: { totalListings: 1 },
      categories: [{ category: 'convoyage' }],
    });
    expect(svcMock.listCategories).toHaveBeenCalledWith(false);
  });

  it('PUT /categories/:category validates the fee and forwards the patch', async () => {
    const bad = await api(admin.baseUrl, 'PUT', '/admin/listings/categories/convoyage', {
      publication_fee_mru: -1,
    });
    expect(bad.status).toBe(400);

    svcMock.updateCategory.mockResolvedValue({ category: 'convoyage', enabled: false, publicationFeeMru: 300 });
    const ok = await api(admin.baseUrl, 'PUT', '/admin/listings/categories/convoyage', {
      enabled: false,
      publication_fee_mru: 300,
    });
    expect(ok.status).toBe(200);
    expect(svcMock.updateCategory).toHaveBeenCalledWith('convoyage', {
      enabled: false,
      publicationFeeMru: 300,
    });
  });
});
