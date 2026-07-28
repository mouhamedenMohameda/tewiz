import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

// Admin i18n editor. The load-bearing rule is placeholder safety: a new value
// must keep the same {{ mustache }} set as the current one unless force:true.
// We mock the pool + withTx + audit and drive the update flow over HTTP.

const { queryMock, auditMock, clientQueries } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  auditMock: vi.fn(async () => {}),
  clientQueries: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
  withTx: async (fn: (c: { query: (sql: string, params: any[]) => Promise<any> }) => Promise<unknown>) => {
    const client = {
      query: async (sql: string, params: any[]) => {
        clientQueries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };
    return fn(client);
  },
}));
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));

import { adminTranslationsRouter } from '../src/modules/admin/translations.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'super_admin' };
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  clientQueries.length = 0;
  app = await startTestApp('/admin/translations', adminTranslationsRouter, ADMIN);
});
afterEach(async () => {
  await app.close();
});

describe('GET /admin/translations', () => {
  it('groups keys by namespace and exposes the fr preview', async () => {
    dispatchSql(queryMock, [[/WHERE lang = 'fr'/, rows([
      { key: 'home.title', value: 'Accueil' },
      { key: 'ride.cancel', value: 'Annuler' },
    ])]]);
    const res = await api(app.baseUrl, 'GET', '/admin/translations');
    expect(res.status).toBe(200);
    expect(res.body.keys).toEqual([
      { key: 'home.title', namespace: 'home', preview: 'Accueil' },
      { key: 'ride.cancel', namespace: 'ride', preview: 'Annuler' },
    ]);
  });
});

describe('GET /admin/translations/:key', () => {
  it('404s for an unknown key', async () => {
    dispatchSql(queryMock, [[/FROM translations WHERE key/, rows([])]]);
    const res = await api(app.baseUrl, 'GET', '/admin/translations/ghost.key');
    expect(res.status).toBe(404);
  });

  it('collapses per-language rows into a values map', async () => {
    dispatchSql(queryMock, [[/FROM translations WHERE key/, rows([
      { lang: 'fr', value: 'Bonjour' },
      { lang: 'en', value: 'Hello' },
    ])]]);
    const res = await api(app.baseUrl, 'GET', '/admin/translations/greeting');
    expect(res.body).toEqual({ key: 'greeting', values: { fr: 'Bonjour', en: 'Hello' } });
  });
});

describe('PUT /admin/translations/:key', () => {
  it('requires at least one language value (400)', async () => {
    const res = await api(app.baseUrl, 'PUT', '/admin/translations/greeting', { values: {} });
    expect(res.status).toBe(400);
  });

  it('404s when the key does not exist', async () => {
    dispatchSql(queryMock, [[/FROM translations WHERE key/, rows([])]]);
    const res = await api(app.baseUrl, 'PUT', '/admin/translations/ghost', { values: { fr: 'X' } });
    expect(res.status).toBe(404);
  });

  it('409 placeholder_mismatch when the {{ }} set changes and force is not set', async () => {
    dispatchSql(queryMock, [[/FROM translations WHERE key/, rows([
      { lang: 'fr', value: 'Bonjour {{name}}' },
    ])]]);
    const res = await api(app.baseUrl, 'PUT', '/admin/translations/greeting', {
      values: { fr: 'Bonjour' }, // dropped the {{name}} placeholder
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('placeholder_mismatch');
    expect(res.body.error.details.mismatches).toEqual(['fr']);
    // Nothing was written.
    expect(clientQueries).toHaveLength(0);
  });

  it('saves anyway with force:true despite a placeholder mismatch', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM translations WHERE key/.test(sql)) {
        return rows([{ lang: 'fr', value: 'Bonjour {{name}}' }]);
      }
      return rows([]);
    });
    const res = await api(app.baseUrl, 'PUT', '/admin/translations/greeting', {
      values: { fr: 'Bonjour' }, force: true,
    });
    expect(res.status).toBe(200);
    expect(clientQueries).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update_translation' }));
  });

  it('updates each provided language and returns the fresh values', async () => {
    let call = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM translations WHERE key/.test(sql)) {
        call += 1;
        // First read = "before", second read = "after".
        return call === 1
          ? rows([{ lang: 'fr', value: 'Bonjour {{name}}' }, { lang: 'en', value: 'Hi {{name}}' }])
          : rows([{ lang: 'fr', value: 'Salut {{name}}' }, { lang: 'en', value: 'Hi {{name}}' }]);
      }
      return rows([]);
    });
    const res = await api(app.baseUrl, 'PUT', '/admin/translations/greeting', {
      values: { fr: 'Salut {{name}}' }, // same placeholder set → allowed
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'greeting', values: { fr: 'Salut {{name}}', en: 'Hi {{name}}' } });
    // One UPDATE issued for fr.
    expect(clientQueries).toHaveLength(1);
    expect(clientQueries[0].params).toEqual(['Salut {{name}}', 'admin-1', 'greeting', 'fr']);
  });
});
