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

    mockedQuery.mockImplementation(async (sql: any) => {
      const text = String(sql);

      if (text.includes('FROM rides r') && text.includes('JOIN users u ON u.id = r.booker_id')) {
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

      if (text.includes('FROM users WHERE id = $1')) {
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
});
