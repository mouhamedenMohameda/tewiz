import { beforeEach, describe, expect, it, vi } from 'vitest';

// Off-ride captain breadcrumb trail. The interesting logic is the pure GPS
// noise filter in ingestTrackBatch and the partition-reaping date math. We mock
// the pool, the cached settings getter, and haversineM so distances are exact
// and the filter branches are deterministic.

const { queryMock, settingsMock, haversineMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  settingsMock: vi.fn(),
  haversineMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock } }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({ getPricingSettings: settingsMock }));
vi.mock('../src/lib/geo.js', () => ({ haversineM: haversineMock }));

import {
  isTrackingEnabled,
  ingestTrackBatch,
  readTrack,
  reapTrackPartitions,
  TRACK_RETENTION_DAYS,
} from '../src/modules/captain/track.service.js';

function sample(over: Partial<{ lat: number; lng: number; accuracyM: number | null; speedMps: number | null; recordedAt: number }> = {}) {
  return { lat: 18.08, lng: -15.97, accuracyM: 10, speedMps: 5, recordedAt: 1_000_000, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no previously-stored point (fresh trail).
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('isTrackingEnabled', () => {
  it('reflects the cached app setting', async () => {
    settingsMock.mockResolvedValue({ trackOfflineEnabled: true });
    expect(await isTrackingEnabled()).toBe(true);
    settingsMock.mockResolvedValue({ trackOfflineEnabled: false });
    expect(await isTrackingEnabled()).toBe(false);
  });
});

describe('ingestTrackBatch — GPS noise filter', () => {
  it('short-circuits on an empty batch without hitting the DB', async () => {
    const r = await ingestTrackBatch('cap-1', []);
    expect(r).toEqual({ accepted: 0, dropped: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts the first sample of a fresh trail (no previous point)', async () => {
    const r = await ingestTrackBatch('cap-1', [sample()]);
    expect(r).toEqual({ accepted: 1, dropped: 0 });
    // One SELECT (prev) + one INSERT.
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO captain_track/.test(c[0]));
    expect(insert).toBeTruthy();
  });

  it('drops a sample whose accuracy is worse than 100 m', async () => {
    const r = await ingestTrackBatch('cap-1', [sample({ accuracyM: 500 })]);
    expect(r).toEqual({ accepted: 0, dropped: 1 });
    expect(queryMock.mock.calls.some((c) => /INSERT/.test(c[0]))).toBe(false);
  });

  it('drops a teleport (jump greater than 5000 m) but keeps the reference point', async () => {
    // First sample accepted (no prev); second is 6 km away → teleport dropped.
    haversineMock.mockReturnValueOnce(6000);
    const r = await ingestTrackBatch('cap-1', [
      sample({ recordedAt: 1_000_000 }),
      sample({ lat: 18.2, recordedAt: 1_060_000 }),
    ]);
    expect(r).toEqual({ accepted: 1, dropped: 1 });
  });

  it('drops an impossible-speed sample (>60 m/s)', async () => {
    // 2000 m in 1 s = 2000 m/s → dropped even though under the 5 km jump cap.
    haversineMock.mockReturnValueOnce(2000);
    const r = await ingestTrackBatch('cap-1', [
      sample({ recordedAt: 1_000_000 }),
      sample({ recordedAt: 1_001_000 }),
    ]);
    expect(r).toEqual({ accepted: 1, dropped: 1 });
  });

  it('drops a near-stationary sample (<25 m from the previous)', async () => {
    haversineMock.mockReturnValueOnce(10);
    const r = await ingestTrackBatch('cap-1', [
      sample({ recordedAt: 1_000_000 }),
      sample({ recordedAt: 1_060_000 }),
    ]);
    expect(r).toEqual({ accepted: 1, dropped: 1 });
  });

  it('keeps a genuine move (>25 m, plausible speed)', async () => {
    haversineMock.mockReturnValueOnce(100);
    const r = await ingestTrackBatch('cap-1', [
      sample({ recordedAt: 1_000_000 }),
      sample({ recordedAt: 1_060_000 }),
    ]);
    expect(r).toEqual({ accepted: 2, dropped: 0 });
  });

  it('seeds the reference from the last stored point (first sample is not blindly kept)', async () => {
    // A previously-stored point exists; the incoming sample is only 5 m away → dropped.
    queryMock.mockImplementation(async (sql: string) => {
      if (/ORDER BY recorded_at DESC/.test(sql))
        return { rows: [{ lat: 18.08, lng: -15.97, t: '999000' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    haversineMock.mockReturnValueOnce(5);
    const r = await ingestTrackBatch('cap-1', [sample({ recordedAt: 1_000_000 })]);
    expect(r).toEqual({ accepted: 0, dropped: 1 });
  });

  it('sorts an out-of-order batch chronologically before filtering', async () => {
    // Provided newest-first; after sorting, both are 100 m apart in +60 s steps.
    haversineMock.mockReturnValue(100);
    const r = await ingestTrackBatch('cap-1', [
      sample({ recordedAt: 1_120_000 }),
      sample({ recordedAt: 1_000_000 }),
      sample({ recordedAt: 1_060_000 }),
    ]);
    expect(r.accepted).toBe(3);
  });
});

describe('readTrack', () => {
  it('maps rows to the API point shape with ISO timestamps', async () => {
    queryMock.mockResolvedValue({
      rows: [{
        lat: 18.08, lng: -15.97, accuracy_m: 12, speed_mps: 4.5,
        recorded_at: new Date('2026-07-01T10:00:00.000Z'),
      }],
      rowCount: 1,
    });
    const pts = await readTrack('cap-1', new Date('2026-07-01'), new Date('2026-07-02'));
    expect(pts).toEqual([{
      lat: 18.08, lng: -15.97, accuracyM: 12, speedMps: 4.5,
      recordedAt: '2026-07-01T10:00:00.000Z',
    }]);
  });
});

describe('reapTrackPartitions — retention math', () => {
  it('ensures upcoming partitions and drops only those past the retention window', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fmt = (d: Date) =>
      `captain_track_${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

    const old = new Date(today);
    old.setUTCDate(old.getUTCDate() - (TRACK_RETENTION_DAYS + 5)); // safely past cutoff
    const recent = new Date(today);
    recent.setUTCDate(recent.getUTCDate() - 1); // within window

    const client = {
      query: vi.fn(async (sql: string) => {
        if (/pg_inherits/.test(sql)) {
          return { rows: [{ child: fmt(old) }, { child: fmt(recent) }, { child: 'captain_track_default' }], rowCount: 3 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const r = await reapTrackPartitions(client as never);

    expect(r.dropped).toEqual([fmt(old)]);
    // The recent partition and the non-dated 'default' are left untouched.
    expect(r.dropped).not.toContain(fmt(recent));
    expect(client.query.mock.calls.some((c) => new RegExp(`DROP TABLE IF EXISTS ${fmt(old)}`).test(c[0]))).toBe(true);
    expect(client.query.mock.calls.some((c) => /ensure_captain_track_partition/.test(c[0]))).toBe(true);
  });
});
