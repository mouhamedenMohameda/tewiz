/**
 * Captain free days (migration 0086).
 *
 * The draw hands out real money — a drawn day is a day the platform earns
 * nothing — so the two business guarantees are asserted rather than assumed:
 *
 *   1. A captain never gets the same weekday two weeks in a row (the perk must
 *      stay unpredictable, and un-plannable).
 *   2. The fleet is spread across the week, so a single day never goes free
 *      for everybody at once.
 *
 * Plus the invariant that protects the ledger: a week is drawn ONCE. A replayed
 * cron pass or two concurrent ride completions must not hand out extra days.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, withTxMock, getPricingSettingsMock, notifyMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  getPricingSettingsMock: vi.fn(),
  notifyMock: vi.fn(async () => {}),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: getPricingSettingsMock,
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyCaptainFreeDays: notifyMock,
}));

import {
  FreeDayGrantError,
  drawWeek,
  grantFreeDay,
  resolveFreeDayOnCompletion,
  revokeFreeDay,
  weekStartOf,
} from '../src/modules/rides/free-days.service.js';

/** One row of captain_free_days. */
interface Row {
  captain_id: string;
  free_date: string;
  week_start: string;
  source?: 'auto' | 'admin';
}

/**
 * An in-memory stand-in for captain_free_days that honours the real primary
 * key, so "drawn twice" shows up here exactly as it would in Postgres.
 */
function fakeDb(rows: Row[] = []) {
  const table = [...rows];
  const client = {
    table,
    query: vi.fn(async (sql: unknown, p: any[] = []) => {
      const text = String(sql);
      if (/pg_advisory_xact_lock/i.test(text)) return { rows: [], rowCount: 0 };

      if (/SELECT free_date, source FROM captain_free_days/i.test(text)) {
        const [captainId, weekStart] = p;
        const hits = table
          .filter((r) => r.captain_id === captainId && r.week_start === weekStart)
          .sort((a, b) => a.free_date.localeCompare(b.free_date));
        return {
          rows: hits.map((r) => ({
            free_date: new Date(`${r.free_date}T00:00:00Z`),
            source: r.source ?? 'auto',
          })),
          rowCount: hits.length,
        };
      }

      // Existence probe used by grantFreeDay after an ON CONFLICT no-op.
      if (/SELECT source FROM captain_free_days/i.test(text)) {
        const [captainId, date] = p;
        const hit = table.find((r) => r.captain_id === captainId && r.free_date === date);
        return { rows: hit ? [{ source: hit.source ?? 'auto' }] : [], rowCount: hit ? 1 : 0 };
      }

      if (/SELECT user_id FROM captains/i.test(text)) {
        return { rows: [{ user_id: p[0] }], rowCount: 1 };
      }

      // grantFreeDay: single-row VALUES insert, source = 'admin'.
      if (/INSERT INTO captain_free_days[\s\S]*VALUES/i.test(text)) {
        const [captainId, date, weekStart] = p as [string, string, string];
        if (table.some((r) => r.captain_id === captainId && r.free_date === date)) {
          return { rows: [], rowCount: 0 };
        }
        table.push({ captain_id: captainId, free_date: date, week_start: weekStart, source: 'admin' });
        return { rows: [{ free_date: new Date(`${date}T00:00:00Z`) }], rowCount: 1 };
      }

      if (/DELETE FROM captain_free_days/i.test(text)) {
        const [captainId, date] = p;
        const i = table.findIndex((r) => r.captain_id === captainId && r.free_date === date);
        if (i < 0) return { rows: [], rowCount: 0 };
        table.splice(i, 1);
        return { rows: [], rowCount: 1 };
      }

      if (/SELECT free_date, COUNT\(\*\)/i.test(text)) {
        const [weekStart] = p;
        const counts = new Map<string, number>();
        for (const r of table) {
          if (r.week_start === weekStart) counts.set(r.free_date, (counts.get(r.free_date) ?? 0) + 1);
        }
        return {
          rows: [...counts].map(([d, n]) => ({ free_date: new Date(`${d}T00:00:00Z`), n: String(n) })),
          rowCount: counts.size,
        };
      }

      if (/INSERT INTO captain_free_days/i.test(text)) {
        const [captainId, weekStart, dates] = p as [string, string, string[]];
        const inserted: string[] = [];
        for (const d of dates) {
          // ON CONFLICT (captain_id, free_date) DO NOTHING
          if (table.some((r) => r.captain_id === captainId && r.free_date === d)) continue;
          table.push({ captain_id: captainId, free_date: d, week_start: weekStart, source: 'auto' });
          inserted.push(d);
        }
        return {
          rows: inserted.map((d) => ({ free_date: new Date(`${d}T00:00:00Z`) })),
          rowCount: inserted.length,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return client;
}

/** 0 = Monday … 6 = Sunday, matching the service's own indexing. */
function weekday(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const WEEK = '2026-08-24';       // a Monday
const PREV_WEEK = '2026-08-17';  // the Monday before

beforeEach(() => {
  vi.clearAllMocks();
  getPricingSettingsMock.mockResolvedValue({ freeDaysEnabled: true, freeDaysPerWeek: 1 });
  withTxMock.mockImplementation(async (fn: any) => fn(fakeDb()));
});

describe('weekStartOf', () => {
  it('maps every day of a week to its Monday', () => {
    expect(weekStartOf('2026-08-24')).toBe(WEEK); // Monday itself
    expect(weekStartOf('2026-08-27')).toBe(WEEK); // Thursday
    expect(weekStartOf('2026-08-30')).toBe(WEEK); // Sunday — not the next Monday
    expect(weekStartOf('2026-08-31')).toBe('2026-08-31'); // next Monday
  });
});

describe('drawWeek — no repeat week-over-week', () => {
  it('never re-draws the weekday the captain had last week', async () => {
    // 40 independent draws: with 7 candidate days, a broken rule would show up
    // ~6 times. Wednesday was free last week and must never come back.
    for (let i = 0; i < 40; i++) {
      const db = fakeDb([{ captain_id: 'cap', free_date: '2026-08-19', week_start: PREV_WEEK }]);
      const draw = await drawWeek(db as any, 'cap', WEEK, 1, WEEK);
      expect(draw.newDays).toHaveLength(1);
      expect(weekday(draw.newDays[0]!)).not.toBe(weekday('2026-08-19'));
    }
  });

  it('relaxes the rule rather than handing out nothing', async () => {
    // Every weekday was free last week, so the no-repeat rule alone leaves no
    // candidate. The captain must still get their day.
    const lastWeek: Row[] = Array.from({ length: 7 }, (_, i) => ({
      captain_id: 'cap',
      free_date: `2026-08-${17 + i}`,
      week_start: PREV_WEEK,
    }));
    const db = fakeDb(lastWeek);
    const draw = await drawWeek(db as any, 'cap', WEEK, 2, WEEK);
    expect(draw.newDays).toHaveLength(2);
  });
});

describe('drawWeek — fleet spreading', () => {
  it('fills the emptiest days first instead of piling onto one', async () => {
    const db = fakeDb();
    // 14 captains, 1 free day each, over 7 weekdays → exactly 2 per day if the
    // load-balancing works. A purely random draw would almost never do this.
    for (let i = 0; i < 14; i++) {
      await drawWeek(db as any, `cap-${i}`, WEEK, 1, WEEK);
    }
    const perDay = new Map<string, number>();
    for (const r of db.table) perDay.set(r.free_date, (perDay.get(r.free_date) ?? 0) + 1);
    expect([...perDay.values()].sort()).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it('does not always pick the same day for the first captain of a week', async () => {
    const picks = new Set<string>();
    for (let i = 0; i < 30; i++) {
      picks.add((await drawWeek(fakeDb() as any, 'cap', WEEK, 1, WEEK)).newDays[0]!);
    }
    // On an empty week every day has load 0, so the tie-break is pure chance.
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('drawWeek — idempotence', () => {
  it('never re-rolls a week that is already drawn', async () => {
    const db = fakeDb();
    const first = await drawWeek(db as any, 'cap', WEEK, 2, WEEK);
    const second = await drawWeek(db as any, 'cap', WEEK, 2, WEEK);
    expect(first.newDays).toHaveLength(2);
    expect(second.newDays).toEqual([]);
    expect(second.days).toEqual(first.days);
    expect(db.table).toHaveLength(2);
  });

  it('tops up when the admin raises the quota mid-week', async () => {
    const db = fakeDb();
    await drawWeek(db as any, 'cap', WEEK, 1, WEEK);
    const after = await drawWeek(db as any, 'cap', WEEK, 3, WEEK);
    expect(after.newDays).toHaveLength(2);
    expect(after.days).toHaveLength(3);
    expect(new Set(after.days).size).toBe(3);
  });

  it('does not take back days when the admin lowers the quota', async () => {
    const db = fakeDb();
    await drawWeek(db as any, 'cap', WEEK, 3, WEEK);
    const after = await drawWeek(db as any, 'cap', WEEK, 1, WEEK);
    expect(after.newDays).toEqual([]);
    expect(after.days).toHaveLength(3);
  });
});

describe('drawWeek — a day already gone is worth nothing', () => {
  it('only draws from today onward', async () => {
    const friday = '2026-08-28';
    const draw = await drawWeek(fakeDb() as any, 'cap', WEEK, 2, friday);
    for (const d of draw.newDays) expect(d >= friday).toBe(true);
  });

  it('draws nothing when the week is already over', async () => {
    const draw = await drawWeek(fakeDb() as any, 'cap', WEEK, 1, '2026-08-31');
    expect(draw.newDays).toEqual([]);
    expect(draw.days).toEqual([]);
  });
});

describe('resolveFreeDayOnCompletion', () => {
  it('waives nothing while the feature is off', async () => {
    getPricingSettingsMock.mockResolvedValue({ freeDaysEnabled: false, freeDaysPerWeek: 3 });
    const db = fakeDb();
    const res = await resolveFreeDayOnCompletion(db as any, 'cap');
    expect(res.isFreeToday).toBe(false);
    // and nothing is drawn — the kill switch must not keep granting days.
    expect(db.table).toHaveLength(0);
  });

  it('turns today free when today was drawn', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const db = fakeDb([{ captain_id: 'cap', free_date: today, week_start: weekStartOf(today) }]);
    const res = await resolveFreeDayOnCompletion(db as any, 'cap');
    expect(res.isFreeToday).toBe(true);
    expect(res.newlyDrawn).toEqual([]);
  });

  it('draws the week on the fly when the daily job has not run', async () => {
    // 7 free days a week: whatever day the draw lands on, today is covered —
    // which makes the lazy path observable without freezing the clock.
    getPricingSettingsMock.mockResolvedValue({ freeDaysEnabled: true, freeDaysPerWeek: 7 });
    const db = fakeDb();
    const res = await resolveFreeDayOnCompletion(db as any, 'cap');
    expect(res.isFreeToday).toBe(true);
    expect(res.newlyDrawn.length).toBeGreaterThan(0);
  });

  it('leaves the captain paying when the drawn day is not today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = weekStartOf(today);
    // Fill the whole week with days belonging to someone else, and give our
    // captain a day that is explicitly not today.
    const other = new Date(`${weekStart}T00:00:00Z`);
    const notToday = [0, 1, 2, 3, 4, 5, 6]
      .map((i) => new Date(other.getTime() + i * 86_400_000).toISOString().slice(0, 10))
      .find((d) => d !== today)!;
    const db = fakeDb([{ captain_id: 'cap', free_date: notToday, week_start: weekStart }]);
    const res = await resolveFreeDayOnCompletion(db as any, 'cap');
    expect(res.isFreeToday).toBe(false);
  });
});

/**
 * Manual grants are a GIFT ON TOP of the quota. The whole point of the feature
 * is compensating a captain, so a gift must not quietly cancel the day the
 * draw was going to hand them anyway — that would make the gesture worthless.
 */
describe('manual grants', () => {
  it('does not consume the weekly quota', async () => {
    const db = fakeDb([
      { captain_id: 'cap', free_date: '2026-08-26', week_start: WEEK, source: 'admin' },
    ]);
    const draw = await drawWeek(db as any, 'cap', WEEK, 1, WEEK);
    // The captain still gets their drawn day, on top of the gifted one.
    expect(draw.newDays).toHaveLength(1);
    expect(draw.days).toHaveLength(2);
    expect(draw.days).toContain('2026-08-26');
  });

  it('still occupies its date — the draw cannot land on it twice', async () => {
    const db = fakeDb([
      { captain_id: 'cap', free_date: '2026-08-26', week_start: WEEK, source: 'admin' },
    ]);
    const draw = await drawWeek(db as any, 'cap', WEEK, 6, WEEK);
    expect(draw.newDays).not.toContain('2026-08-26');
    expect(new Set(draw.days).size).toBe(draw.days.length);
  });

  it('blocks its weekday from repeating the following week', async () => {
    for (let i = 0; i < 30; i++) {
      const db = fakeDb([
        { captain_id: 'cap', free_date: '2026-08-19', week_start: PREV_WEEK, source: 'admin' },
      ]);
      const draw = await drawWeek(db as any, 'cap', WEEK, 1, WEEK);
      expect(weekday(draw.newDays[0]!)).not.toBe(weekday('2026-08-19'));
    }
  });

  it('does not re-trigger a draw on every completion', async () => {
    // Quota already met by the draw; a gift on top must not look like a
    // shortfall next time a ride completes.
    getPricingSettingsMock.mockResolvedValue({ freeDaysEnabled: true, freeDaysPerWeek: 1 });
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = weekStartOf(today);
    const db = fakeDb([
      { captain_id: 'cap', free_date: today, week_start: weekStart, source: 'auto' },
      { captain_id: 'cap', free_date: today, week_start: weekStart, source: 'admin' },
    ]);
    const res = await resolveFreeDayOnCompletion(db as any, 'cap');
    expect(res.newlyDrawn).toEqual([]);
    expect(res.isFreeToday).toBe(true);
  });
});

describe('grantFreeDay / revokeFreeDay', () => {
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  it('grants a future day as an admin gift', async () => {
    const db = fakeDb();
    withTxMock.mockImplementation(async (fn: any) => fn(db));
    const res = await grantFreeDay('cap', tomorrow());
    expect(res.granted).toBe(true);
    expect(db.table[0]).toMatchObject({ source: 'admin', free_date: tomorrow() });
  });

  it('refuses a day that is already over', async () => {
    // Silently accepting would let an admin believe they compensated a captain
    // when nothing was actually waived.
    await expect(grantFreeDay('cap', yesterday())).rejects.toBeInstanceOf(FreeDayGrantError);
  });

  it('refuses a date past the 90-day horizon', async () => {
    const farOff = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await expect(grantFreeDay('cap', farOff)).rejects.toBeInstanceOf(FreeDayGrantError);
  });

  it('is idempotent and never rewrites a drawn day as a gift', async () => {
    const day = tomorrow();
    const db = fakeDb([
      { captain_id: 'cap', free_date: day, week_start: weekStartOf(day), source: 'auto' },
    ]);
    withTxMock.mockImplementation(async (fn: any) => fn(db));
    const res = await grantFreeDay('cap', day);
    expect(res).toEqual({ granted: false, date: day, alreadyHeld: 'auto' });
    expect(db.table).toHaveLength(1);
    expect(db.table[0]!.source).toBe('auto');
  });

  it('revokes a future day', async () => {
    const day = tomorrow();
    const db = fakeDb([
      { captain_id: 'cap', free_date: day, week_start: weekStartOf(day), source: 'admin' },
    ]);
    poolQueryMock.mockImplementation(db.query);
    const res = await revokeFreeDay('cap', day);
    expect(res.revoked).toBe(true);
    expect(db.table).toHaveLength(0);
  });

  it('refuses to revoke today — the waiver has already been applied', async () => {
    // Rides completed today were debited 0. Deleting the row wouldn't claw
    // that back, it would just make the ledger disagree with the ride flags.
    const today = new Date().toISOString().slice(0, 10);
    await expect(revokeFreeDay('cap', today)).rejects.toBeInstanceOf(FreeDayGrantError);
  });

  it('reports when there was nothing to revoke', async () => {
    const db = fakeDb();
    poolQueryMock.mockImplementation(db.query);
    expect((await revokeFreeDay('cap', tomorrow())).revoked).toBe(false);
  });
});
