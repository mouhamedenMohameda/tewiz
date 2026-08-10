import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSql, rows } from './helpers/db.js';

// getOrCreateDraft: the open-application lookup is per user_id, but the
// `captain_applications_open_one` index is per phone. When a number moves to a
// fresh account the old row is left behind, and the INSERT used to blow up on
// the index — the applicant saw a bare 500 on the very first tap.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock }, withTx: vi.fn() }));
vi.mock('../src/modules/admin/document-requirements.service.js', () => ({
  getDocumentRequirements: async () => [],
  getRequiredDocumentTypes: async () => new Set(),
}));

import { getOrCreateDraft } from '../src/modules/captain/application.service.js';

const USER = 'user-1';
const PHONE = '+22244000001';

const OPEN_BY_USER = /SELECT \* FROM captain_applications\s+WHERE user_id/;
const CAPTAIN_RE = /FROM captains WHERE user_id/;
const USER_RE = /SELECT phone, role FROM users/;
const RECLAIM_RE = /UPDATE captain_applications a\s+SET user_id/;
const INSERT_RE = /INSERT INTO captain_applications/;
const DOCS_RE = /FROM application_documents/;

/** Base routing: no application under this user_id, a plain rider with a phone. */
function baseTable(): Array<[RegExp, any]> {
  return [
    [OPEN_BY_USER, rows([])],
    [CAPTAIN_RE, rows([])],
    [USER_RE, rows([{ phone: PHONE, role: 'rider' }])],
    [DOCS_RE, rows([])],
  ];
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('getOrCreateDraft', () => {
  it('re-attaches an open application left behind under a stale user_id', async () => {
    dispatchSql(queryMock, [
      [RECLAIM_RE, rows([{ id: 'app-old', status: 'draft', phone: PHONE, vehicle_type: 'car' }])],
      ...baseTable(),
    ]);

    const app = await getOrCreateDraft(USER);

    expect(app.id).toBe('app-old');
    // The orphan is reused, not duplicated.
    const sqls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((s) => INSERT_RE.test(s))).toBe(false);
    const reclaim = queryMock.mock.calls.find(([sql]) => RECLAIM_RE.test(String(sql)));
    expect(reclaim?.[1]).toEqual([PHONE, USER]);
  });

  it('creates a draft when no open application exists for the phone', async () => {
    dispatchSql(queryMock, [
      [RECLAIM_RE, rows([])],
      [INSERT_RE, rows([{ id: 'app-new', status: 'draft', phone: PHONE, vehicle_type: 'car' }])],
      ...baseTable(),
    ]);

    const app = await getOrCreateDraft(USER);
    expect(app.id).toBe('app-new');
  });

  it('turns a unique-violation on insert into a 409, never a 500', async () => {
    dispatchSql(queryMock, [
      [RECLAIM_RE, rows([])],
      [INSERT_RE, () => {
        // A live account still owns the open application for this number.
        const e: any = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      }],
      ...baseTable(),
    ]);

    await expect(getOrCreateDraft(USER)).rejects.toMatchObject({
      status: 409,
      code: 'application_exists',
    });
  });
});
