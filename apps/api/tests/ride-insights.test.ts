import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../src/db/pool.js';
import { getRideInsights } from '../src/modules/rides/ride-insights.service.js';

describe('getRideInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero destination demand for open rides and does not query dropoff demand', async () => {
    const mockedQuery = vi.mocked(pool.query);

    mockedQuery.mockImplementation(async (sql: any, params: any[] = []) => {
      const text = String(sql);

      if (text.includes('SELECT r.booker_id') && text.includes('JOIN users u ON u.id = r.booker_id')) {
        return {
          rows: [{
            booker_id: '00000000-0000-0000-0000-000000000123',
            booker_role: 'rider',
            booker_phone: '+22230112233',
            passenger_name: null,
            passenger_phone: null,
            is_open: true,
            pickup_lat: 18.0735,
            pickup_lng: -15.9582,
            dropoff_lat: 18.0791,
            dropoff_lng: -15.9653,
          }],
        } as any;
      }

      if (text.includes('WITH target AS')) {
        expect(params[0]).toBe('+22230112233');
        return {
          rows: [{
            user_id: '00000000-0000-0000-0000-000000000123',
            full_name: 'Test Rider',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            total: '4',
            completed: '3',
            cancelled_by_rider: '1',
            no_show: '0',
            avg_rating: '4.50',
            ratings_count: '2',
          }],
        } as any;
      }

      if (text.includes('FROM voiceloc_pois p')) {
        return { rows: [] } as any;
      }

      throw new Error(`Unexpected SQL in test: ${text.slice(0, 120)}`);
    });

    const insights = await getRideInsights('ride-open-1');

    expect(insights.destination.ridesLast2h).toBe(0);
    expect(insights.destination.ridesYesterdaySameHour).toBe(0);
    expect(insights.dropoff).toBeNull();

    const calledSql = mockedQuery.mock.calls.map((call) => String(call[0]));
    expect(calledSql.some((sql) => sql.includes('ST_DWithin(r.dropoff_location'))).toBe(false);
  });

  it('aggregates rider stats by passenger phone for operator rides instead of admin account', async () => {
    const mockedQuery = vi.mocked(pool.query);

    mockedQuery.mockImplementation(async (sql: any, params: any[] = []) => {
      const text = String(sql);

      if (text.includes('SELECT r.booker_id') && text.includes('JOIN users u ON u.id = r.booker_id')) {
        return {
          rows: [{
            booker_id: '00000000-0000-0000-0000-00000000admin',
            booker_role: 'admin',
            booker_phone: '+22230000000',
            passenger_name: 'Client CallCenter',
            passenger_phone: '+22241122334',
            is_open: false,
            pickup_lat: 18.1001,
            pickup_lng: -15.9502,
            dropoff_lat: 18.1203,
            dropoff_lng: -15.9704,
          }],
        } as any;
      }

      if (text.includes('ST_DWithin(r.dropoff_location')) {
        return {
          rows: [{
            rides_last_2h: '7',
            rides_yesterday: '5',
          }],
        } as any;
      }

      if (text.includes('WITH target AS')) {
        expect(params[0]).toBe('+22241122334');
        expect(params[1]).toBe('Client CallCenter');
        return {
          rows: [{
            user_id: '00000000-0000-0000-0000-00000000rider',
            full_name: 'Client CallCenter',
            created_at: new Date('2025-06-01T00:00:00.000Z'),
            total: '12',
            completed: '9',
            cancelled_by_rider: '2',
            no_show: '1',
            avg_rating: '4.80',
            ratings_count: '6',
          }],
        } as any;
      }

      if (text.includes('FROM voiceloc_pois p')) {
        return { rows: [] } as any;
      }

      throw new Error(`Unexpected SQL in test: ${text.slice(0, 120)}`);
    });

    const insights = await getRideInsights('ride-operator-1');

    expect(insights.rider.totalRides).toBe(12);
    expect(insights.rider.completedRides).toBe(9);
    expect(insights.rider.noShowRides).toBe(1);
    expect(insights.rider.fullName).toBe('Client CallCenter');
    expect(insights.rider.userId).toBe('00000000-0000-0000-0000-00000000rider');

    const calledSql = mockedQuery.mock.calls.map((call) => String(call[0]));
    expect(calledSql.some((text) => text.includes('WITH target AS'))).toBe(true);
    expect(calledSql.some((text) => text.includes('FROM users WHERE id = $1'))).toBe(false);
  });
});
