import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const {
  svcMock,
  menuMock,
  auditMock,
  txQueryMock,
  storageGetMock,
  storagePutMock,
  sharpMock,
  sharpResizeMock,
  sharpWebpMock,
  sharpToBufferMock,
} = vi.hoisted(() => ({
  svcMock: {
    listRestaurants: vi.fn(),
    getRestaurant: vi.fn(),
    upsertRestaurant: vi.fn(),
    patchRestaurant: vi.fn(),
    softDeleteRestaurant: vi.fn(),
    fromOsmSeed: vi.fn(),
  },
  menuMock: { getRestaurantMenu: vi.fn() },
  auditMock: vi.fn(),
  txQueryMock: vi.fn(),
  storageGetMock: vi.fn(),
  storagePutMock: vi.fn(),
  sharpMock: vi.fn(),
  sharpResizeMock: vi.fn(),
  sharpWebpMock: vi.fn(),
  sharpToBufferMock: vi.fn(),
}));

vi.mock('../src/modules/restaurants/restaurants.service.js', () => svcMock);
vi.mock('../src/modules/restaurants/dishes.service.js', () => menuMock);
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/storage/local-disk.js', () => ({
  defaultStorage: {
    get: storageGetMock,
    put: storagePutMock,
  },
}));
vi.mock('../src/middleware/upload.js', () => ({
  upload: {
    single: () => (req: any, _res: any, next: () => void) => {
      const b64 = req?.body?.mockFileB64;
      req.file = b64 ? { buffer: Buffer.from(b64, 'base64') } : undefined;
      next();
    },
  },
}));
vi.mock('sharp', () => ({ default: sharpMock }));
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
  menuMock.getRestaurantMenu.mockReset();
  // GET /rider/restaurants/:id also loads the (available-only) menu; default
  // to an empty menu so tests that don't care about dishes still pass.
  menuMock.getRestaurantMenu.mockResolvedValue([]);
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  storageGetMock.mockReset();
  storagePutMock.mockReset();
  sharpMock.mockReset();
  sharpResizeMock.mockReset();
  sharpWebpMock.mockReset();
  sharpToBufferMock.mockReset();
  sharpToBufferMock.mockResolvedValue(Buffer.from('optimized-webp'));
  sharpWebpMock.mockReturnValue({ toBuffer: sharpToBufferMock });
  sharpResizeMock.mockReturnValue({ webp: sharpWebpMock });
  sharpMock.mockReturnValue({ resize: sharpResizeMock });
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

  it('GET /photos/:filename streams the stored webp photo', async () => {
    storageGetMock.mockResolvedValue(Buffer.from('photo'));
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/rider/restaurants/photos/r1.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(storageGetMock).toHaveBeenCalledWith('restaurants/r1.webp');
  });

  it('GET /photos/:filename returns 404 when the photo is missing', async () => {
    storageGetMock.mockRejectedValue(new Error('missing'));
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/restaurants/photos/missing.webp');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
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

  it('POST /upload-photo returns 400 when no file was provided', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/restaurants/upload-photo', {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_file');
  });

  it('POST /upload-photo optimizes and stores the uploaded image', async () => {
    const { baseUrl } = await start();
    const raw = Buffer.from('raw-image-bytes');
    const res = await api(baseUrl, 'POST', '/admin/restaurants/upload-photo', {
      mockFileB64: raw.toString('base64'),
    });
    expect(res.status).toBe(200);
    // The endpoint now returns an ABSOLUTE URL to the public (no-auth) photo
    // route so the mobile <Image> / admin <img> can load it directly.
    expect(res.body.url).toMatch(
      /^https?:\/\/[^/]+\/public\/restaurant-photos\/[a-f0-9-]+\.webp$/i,
    );
    expect(sharpMock).toHaveBeenCalledWith(raw);
    expect(sharpResizeMock).toHaveBeenCalledWith(800, 800, {
      fit: 'cover',
      withoutEnlargement: true,
    });
    expect(sharpWebpMock).toHaveBeenCalledWith({ quality: 80 });
    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringMatching(/^restaurants\/[a-f0-9-]+\.webp$/i),
      Buffer.from('optimized-webp'),
      'image/webp',
    );
  });

  it('GET /photos/:filename streams the stored webp photo', async () => {
    storageGetMock.mockResolvedValue(Buffer.from('admin-photo'));
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/admin/restaurants/photos/r2.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/webp');
    expect(storageGetMock).toHaveBeenCalledWith('restaurants/r2.webp');
  });

  it('GET /photos/:filename returns 404 when missing', async () => {
    storageGetMock.mockRejectedValue(new Error('missing'));
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/restaurants/photos/missing.webp');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
