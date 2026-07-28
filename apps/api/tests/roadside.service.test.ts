import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSql, rows } from './helpers/db.js';

// Roadside SOS service: create/accept/cancel + the expand-or-give-up cron.
// We mock the pool (routed by SQL regex) and the push module so dispatch is a
// no-op we can count. getConfig reads app_settings row id=1.

const { queryMock, notifyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock } }));
vi.mock('../src/modules/push/expo-push.js', () => ({
  notifyProvidersRoadside: notifyMock,
}));

import {
  createRequest,
  getCurrentForRequester,
  cancelRequest,
  acceptRequest,
  updateProviderStatus,
  getProviderProfile,
  setProviderProfile,
  expandAndExpire,
} from '../src/modules/roadside/roadside.service.js';

const CFG = {
  roadside_assistance_enabled: true,
  roadside_initial_radius_m: 3000,
  roadside_radius_step_m: 2000,
  roadside_max_radius_m: 10000,
  roadside_expand_interval_s: 30,
  roadside_request_timeout_s: 300,
  roadside_lead_fee_mru: 200,
  roadside_hotline_phone: '+22200000000',
};

const CONFIG_RE = /FROM app_settings WHERE id = 1/;

function requestRow(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    requester_id: 'rider-1',
    problem_type: 'pneu',
    note: null,
    address_label: null,
    status: 'searching',
    search_radius_m: 3000,
    provider_id: null,
    provider_phone: null,
    requester_phone: '22201',
    lat: 18.08,
    lng: -15.97,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    provider_name: null,
    provider_rating: null,
    provider_lat: null,
    provider_lng: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifyMock.mockResolvedValue(undefined);
});

describe('createRequest', () => {
  it('throws 403 when roadside is disabled', async () => {
    dispatchSql(queryMock, [[CONFIG_RE, rows([{ ...CFG, roadside_assistance_enabled: false }])]]);
    await expect(createRequest('rider-1', { problemType: 'pneu', lat: 1, lng: 2 })).rejects.toMatchObject({
      status: 403,
      code: 'roadside_disabled',
    });
  });

  it('throws 409 when the requester already has an active SOS', async () => {
    dispatchSql(queryMock, [
      [CONFIG_RE, rows([CFG])],
      [/SELECT 1 FROM roadside_requests/, rows([{ '?column?': 1 }])],
    ]);
    await expect(createRequest('rider-1', { problemType: 'pneu', lat: 1, lng: 2 })).rejects.toMatchObject({
      status: 409,
      code: 'roadside_active',
    });
  });

  it('clamps the requested radius to maxRadiusM and returns the DTO + notified count', async () => {
    dispatchSql(queryMock, [
      [CONFIG_RE, rows([CFG])],
      [/SELECT 1 FROM roadside_requests/, rows([])],
      [/INSERT INTO roadside_requests/, rows([requestRow({ search_radius_m: 10000 })])],
      // eligibleProviders returns two captains
      [/roadside_providers rp/, rows([{ captain_id: 'c1', dist_m: 500 }, { captain_id: 'c2', dist_m: 900 }])],
    ]);

    const result = await createRequest('rider-1', {
      problemType: 'pneu',
      lat: 18.08,
      lng: -15.97,
      radiusM: 99_999, // way over max
    });

    // Insert received the clamped radius as $8.
    const insertCall = queryMock.mock.calls.find((c) => /INSERT INTO roadside_requests/.test(c[0]));
    expect(insertCall![1][7]).toBe(10000);

    expect(result.providersNotified).toBe(2);
    expect(result.request.searchRadiusM).toBe(10000);
    expect(result.request.status).toBe('searching');
    // Still searching → no provider block, no hotline yet.
    expect(result.request.provider).toBeNull();
    expect(result.request.hotlinePhone).toBeNull();
    expect(notifyMock).toHaveBeenCalledWith(['c1', 'c2'], expect.objectContaining({ id: 'req-1' }));
  });
});

describe('toDTO (via getCurrentForRequester)', () => {
  it('returns null when there is no active request', async () => {
    dispatchSql(queryMock, [
      [CONFIG_RE, rows([CFG])],
      [/FROM roadside_requests r/, rows([])],
    ]);
    expect(await getCurrentForRequester('rider-1')).toBeNull();
  });

  it('exposes the provider block only once accepted', async () => {
    dispatchSql(queryMock, [
      [CONFIG_RE, rows([CFG])],
      [
        /FROM roadside_requests r/,
        rows([
          requestRow({
            status: 'accepted',
            provider_id: 'cap-9',
            provider_phone: '22299',
            provider_name: 'Ahmed',
            provider_rating: '4.5',
            provider_lat: 18.1,
            provider_lng: -15.9,
          }),
        ]),
      ],
    ]);

    const dto = await getCurrentForRequester('rider-1');
    expect(dto!.provider).toEqual({
      name: 'Ahmed',
      phone: '22299',
      ratingAvg: 4.5,
      location: { lat: 18.1, lng: -15.9 },
    });
    // hotline only surfaces for 'unresolved'.
    expect(dto!.hotlinePhone).toBeNull();
  });

  it('surfaces the hotline number when the request is unresolved', async () => {
    dispatchSql(queryMock, [
      [CONFIG_RE, rows([CFG])],
      [/FROM roadside_requests r/, rows([requestRow({ status: 'unresolved' })])],
    ]);
    const dto = await getCurrentForRequester('rider-1');
    expect(dto!.provider).toBeNull();
    expect(dto!.hotlinePhone).toBe('+22200000000');
  });
});

describe('acceptRequest — first-to-accept wins', () => {
  it('throws 409 when the atomic UPDATE matched no searching row', async () => {
    dispatchSql(queryMock, [[/UPDATE roadside_requests r/, rows([])]]);
    await expect(acceptRequest('req-1', 'cap-1')).rejects.toMatchObject({
      status: 409,
      code: 'already_taken',
    });
  });

  it('returns mapped details with safe defaults for missing name/phone', async () => {
    dispatchSql(queryMock, [
      [
        /UPDATE roadside_requests r/,
        rows([
          {
            problem_type: 'batterie',
            note: 'help',
            address_label: 'Tevragh Zeina',
            lat: 18.08,
            lng: -15.97,
            requester_name: null,
            requester_phone: null,
          },
        ]),
      ],
    ]);

    const r = await acceptRequest('req-1', 'cap-1');
    expect(r).toEqual({
      requestId: 'req-1',
      problemType: 'batterie',
      note: 'help',
      location: { lat: 18.08, lng: -15.97 },
      addressLabel: 'Tevragh Zeina',
      requesterName: 'Conducteur',
      requesterPhone: '',
    });
  });
});

describe('cancelRequest / updateProviderStatus — rowCount → boolean', () => {
  it('cancelRequest returns true when a row was updated', async () => {
    dispatchSql(queryMock, [[/UPDATE roadside_requests/, { rows: [], rowCount: 1 }]]);
    expect(await cancelRequest('req-1', 'rider-1', 'solved')).toBe(true);
  });
  it('cancelRequest returns false when nothing matched', async () => {
    dispatchSql(queryMock, [[/UPDATE roadside_requests/, { rows: [], rowCount: 0 }]]);
    expect(await cancelRequest('req-1', 'rider-1')).toBe(false);
  });
  it('updateProviderStatus returns false when nothing matched', async () => {
    dispatchSql(queryMock, [[/UPDATE roadside_requests/, { rows: [], rowCount: 0 }]]);
    expect(await updateProviderStatus('req-1', 'cap-1', 'completed')).toBe(false);
  });
});

describe('getProviderProfile', () => {
  it('returns opted-out defaults when the user has no provider row', async () => {
    dispatchSql(queryMock, [[/FROM roadside_providers WHERE user_id/, rows([])]]);
    expect(await getProviderProfile('u1')).toEqual({ offersRoadside: false, specialties: [] });
  });
  it('reflects an existing provider row', async () => {
    dispatchSql(queryMock, [
      [/FROM roadside_providers WHERE user_id/, rows([{ enabled: true, specialties: ['pneu', 'batterie'] }])],
    ]);
    expect(await getProviderProfile('u1')).toEqual({
      offersRoadside: true,
      specialties: ['pneu', 'batterie'],
    });
  });
});

describe('setProviderProfile', () => {
  it('upserts and echoes back the persisted enabled/specialties', async () => {
    dispatchSql(queryMock, [
      [/INSERT INTO roadside_providers/, rows([{ enabled: true, specialties: ['moteur'] }])],
    ]);
    const r = await setProviderProfile('u1', true, ['moteur']);
    expect(r).toEqual({ offersRoadside: true, specialties: ['moteur'] });
  });
});

describe('expandAndExpire — cron logic', () => {
  it('marks a request unresolved once past max radius AND timeout', async () => {
    let updateSql = '';
    queryMock.mockImplementation(async (sql: string, params?: any[]) => {
      if (CONFIG_RE.test(sql)) return rows([CFG]);
      if (/WHERE status = 'searching'/.test(sql) && /last_expanded_at/.test(sql))
        return rows([{ id: 'req-1', problem_type: 'pneu', search_radius_m: 10000, age_s: 100 }]);
      if (/now\(\) - created_at/.test(sql)) return rows([{ age_s: 400 }]); // over timeout
      if (/SET status = 'unresolved'/.test(sql)) {
        updateSql = sql;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await expandAndExpire();
    expect(res).toEqual({ expanded: 0, unresolved: 1 });
    expect(updateSql).toMatch(/status = 'unresolved'/);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('expands the radius and re-dispatches while still under max', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (CONFIG_RE.test(sql)) return rows([CFG]);
      if (/WHERE status = 'searching'/.test(sql) && /last_expanded_at/.test(sql))
        return rows([{ id: 'req-1', problem_type: 'pneu', search_radius_m: 3000, age_s: 40 }]);
      if (/now\(\) - created_at/.test(sql)) return rows([{ age_s: 40 }]);
      if (/roadside_providers rp/.test(sql)) return rows([{ captain_id: 'c1', dist_m: 100 }]);
      return { rows: [], rowCount: 1 };
    });

    const res = await expandAndExpire();
    expect(res).toEqual({ expanded: 1, unresolved: 0 });
    // Next radius = 3000 + 2000 step = 5000, re-dispatched to the eligible captain.
    const setRadius = queryMock.mock.calls.find((c) => /SET search_radius_m = \$2/.test(c[0]));
    expect(setRadius![1][1]).toBe(5000);
    expect(notifyMock).toHaveBeenCalledWith(['c1'], expect.objectContaining({ id: 'req-1' }));
  });
});
