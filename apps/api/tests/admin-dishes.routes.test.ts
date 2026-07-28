import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

// Admin dish catalog router. Thin layer over dishes.service; we assert query
// validation/coercion, the create→audit→201 flow, and that audit runs with the
// created dish.

const { svcMock, auditMock } = vi.hoisted(() => ({
  svcMock: { listDishes: vi.fn(), createDish: vi.fn() },
  auditMock: vi.fn(async () => {}),
}));

vi.mock('../src/modules/restaurants/dishes.service.js', () => svcMock);
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));

import { adminDishesRouter } from '../src/modules/restaurants/admin-dishes.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const };
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/admin/dishes', adminDishesRouter, ADMIN);
});
afterEach(async () => {
  await app.close();
});

describe('GET /admin/dishes', () => {
  it('defaults the limit to 500 and forwards the search', async () => {
    svcMock.listDishes.mockResolvedValue([{ id: 'd1' }]);
    const res = await api(app.baseUrl, 'GET', '/admin/dishes?search=riz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'd1' }] });
    expect(svcMock.listDishes).toHaveBeenCalledWith({ search: 'riz', limit: 500 });
  });

  it('coerces a numeric limit from the query string', async () => {
    svcMock.listDishes.mockResolvedValue([]);
    await api(app.baseUrl, 'GET', '/admin/dishes?limit=10');
    expect(svcMock.listDishes).toHaveBeenCalledWith({ search: undefined, limit: 10 });
  });

  it('rejects a limit over the 1000 cap (400)', async () => {
    const res = await api(app.baseUrl, 'GET', '/admin/dishes?limit=5000');
    expect(res.status).toBe(400);
    expect(svcMock.listDishes).not.toHaveBeenCalled();
  });
});

describe('POST /admin/dishes', () => {
  it('requires a non-empty Arabic name (400)', async () => {
    const res = await api(app.baseUrl, 'POST', '/admin/dishes', { nameAr: '' });
    expect(res.status).toBe(400);
    expect(svcMock.createDish).not.toHaveBeenCalled();
  });

  it('creates a dish, writes an audit entry, and returns 201', async () => {
    const dish = { id: 'd1', nameAr: 'أرز', nameFr: 'Riz' };
    svcMock.createDish.mockResolvedValue(dish);
    const res = await api(app.baseUrl, 'POST', '/admin/dishes', { nameAr: 'أرز', nameFr: 'Riz' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(dish);
    expect(svcMock.createDish).toHaveBeenCalledWith(
      { nameAr: 'أرز', nameFr: 'Riz' },
      'admin-1',
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dish_create',
      targetId: 'd1',
      after: dish,
    }));
  });
});
