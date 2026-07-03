import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { svcMock, auditMock, txQueryMock } = vi.hoisted(() => ({
  svcMock: {
    listRestaurants: vi.fn(),
    getRestaurant: vi.fn(),
    upsertRestaurant: vi.fn(),
    patchRestaurant: vi.fn(),
    softDeleteRestaurant: vi.fn(),
    fromOsmSeed: vi.fn(),
  },
  auditMock: vi.fn(),
  txQueryMock: vi.fn(),
}));

vi.mock('../src/modules/restaurants/restaurants.service.js', () => svcMock);
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(), on: vi.fn() },
  withTx: async (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
}));

import { riderRestaurantsRouter } from '../src/modules/restaurants/rider-restaurants.routes.js';
import { adminRestaurantsRouter } from '../src/modules/restaurants/admin-restaurants.routes.js';

const RIDER = { id: 'rider-1', role: 'rider' as const };
const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'ops_manager' };

let handle: TestAppHandle | null = null;

beforeEach(() => {
  for (const fn of Object.values(svcMock)) fn.mockReset();
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('rider restaurants', () => {
  async function start() {
    handle = await startTestApp('/rider/restaurants', riderRestaurantsRouter, RIDER);
    return handle;
  }

  it('GET / lists active restaurants with filters', async () => {
    svcMock.listRestaurants.mockResolvedValue({ items: [{ id: 'resto-1' }], total: 1 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/restaurants?search=pizza&cuisine=italien&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, limit: 10, offset: 0 });
    expect(svcMock.listRestaurants).toHaveBeenCalledWith({
      search: 'pizza',
      cuisine: 'italien',
      limit: 10,
      offset: 0,
    });
  });

  it('GET /:id returns 404 for an unknown or inactive restaurant', async () => {
    svcMock.getRestaurant.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/restaurants/ghost');
    expect(res.status).toBe(404);
  });

  it('GET /:id returns the restaurant', async () => {
    svcMock.getRestaurant.mockResolvedValue({ id: 'resto-1', name: 'Pizza Nktt' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/restaurants/resto-1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Pizza Nktt');
  });
});

describe('admin restaurants', () => {
  async function start() {
    handle = await startTestApp('/admin/restaurants', adminRestaurantsRouter, ADMIN);
    return handle;
  }

  const restoBody = { name: 'Chez Salma', lat: 18.09, lng: -15.96, cuisine: 'mauritanien' };

  it('GET / includes inactive rows by default', async () => {
    svcMock.listRestaurants.mockResolvedValue({ items: [], total: 0 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/restaurants');
    expect(res.status).toBe(200);
    expect(svcMock.listRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({ includeInactive: true }),
    );
  });

  it('POST / creates a restaurant and audits it (201)', async () => {
    svcMock.upsertRestaurant.mockResolvedValue({ id: 'chez-salma', name: 'Chez Salma' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants', restoBody);
    expect(res.status).toBe(201);
    expect(svcMock.upsertRestaurant).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chez Salma' }),
      'admin-1',
      expect.anything(),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'restaurant_create' }));
  });

  it('POST / rejects an uppercase slug id (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants', { ...restoBody, id: 'Chez-Salma' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id returns 404 for an unknown restaurant', async () => {
    svcMock.getRestaurant.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/restaurants/ghost', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('PATCH /:id updates and audits with before/after', async () => {
    svcMock.getRestaurant.mockResolvedValue({ id: 'resto-1', name: 'Ancien nom' });
    svcMock.patchRestaurant.mockResolvedValue({ id: 'resto-1', name: 'Nouveau nom' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/restaurants/resto-1', { name: 'Nouveau nom' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nouveau nom');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'restaurant_update',
        before: { id: 'resto-1', name: 'Ancien nom' },
      }),
    );
  });

  it('DELETE /:id soft-deletes', async () => {
    svcMock.getRestaurant.mockResolvedValue({ id: 'resto-1', name: 'X', isActive: true });
    svcMock.softDeleteRestaurant.mockResolvedValue(true);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/admin/restaurants/resto-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(svcMock.softDeleteRestaurant).toHaveBeenCalledWith('resto-1', 'admin-1');
  });

  it('POST /bulk-import upserts valid items and reports the invalid ones', async () => {
    svcMock.upsertRestaurant.mockResolvedValue({ id: 'ok-1', name: 'Ok One' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants/bulk-import', {
      items: [
        { name: 'Ok One', lat: 18.1, lng: -15.9 },
        { name: '', lat: 18.1, lng: -15.9 }, // invalid: empty name
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].index).toBe(1);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restaurant_bulk_import' }),
    );
  });

  it('POST /bulk-import normalizes OSM-shaped items via fromOsmSeed', async () => {
    svcMock.fromOsmSeed.mockReturnValue({ id: 'osm-1', name: 'OSM Resto', lat: 18.1, lng: -15.9 });
    svcMock.upsertRestaurant.mockResolvedValue({ id: 'osm-1', name: 'OSM Resto' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants/bulk-import', {
      items: [{ name_default: 'OSM Resto', raw_tags: {} }],
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(svcMock.fromOsmSeed).toHaveBeenCalled();
  });

  it('POST /bulk-import with only invalid items is a 400 no_valid_items', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants/bulk-import', {
      items: [{ name: '', lat: 18.1, lng: -15.9 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_valid_items');
  });
});
