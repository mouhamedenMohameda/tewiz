import { beforeEach, describe, expect, it, vi } from 'vitest';

// Marketplace metrics. The interesting behaviour is not "does prom-client work"
// but the decisions layered on top of it: how empty windows are reported, that
// per-zone series disappear when a zone goes quiet, that label cardinality stays
// bounded, and that a match is only counted after the transaction commits.
//
// The pool is mocked so each test can hand refreshSqlGauges a specific set of
// rows; the queries are matched on a distinctive fragment of their SQL rather
// than on call order, so reordering the refresh body does not break the tests.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
}));

const {
  registry,
  refreshSqlGauges,
  recordMatch,
  ridesRequested,
  rideAcceptRejected,
} = await import('../src/lib/metrics.js');

/** Rows returned by the four queries refreshSqlGauges runs, keyed by SQL fragment. */
interface Fixture {
  live?: Record<string, string>;
  window?: Record<string, string | null>;
  pickups?: { lat: number; lng: number; unfilled: boolean }[];
  money?: Record<string, string>;
}

function stubQueries(f: Fixture) {
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('stale_location')) {
      return Promise.resolve({
        rows: [
          f.live ?? { searching: '0', online: '0', on_ride: '0', stale_location: '0' },
        ],
      });
    }
    if (sql.includes('percentile_disc')) {
      return Promise.resolve({
        rows: [
          f.window ?? { requested: '0', matched: '0', no_captain: '0', p50: null, p95: null },
        ],
      });
    }
    if (sql.includes('pickup_location IS NOT NULL')) {
      return Promise.resolve({ rows: f.pickups ?? [], rowCount: (f.pickups ?? []).length });
    }
    if (sql.includes('balance_mru')) {
      return Promise.resolve({ rows: [f.money ?? { blocked: '0', drift: '0' }] });
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}

/** Reads a single sample's value out of the registry by metric + label match. */
async function sample(name: string, labels: Record<string, string> = {}) {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  if (!metric) return undefined;
  const found = (metric.values as { value: number; labels: Record<string, string> }[]).find(
    (v) => Object.entries(labels).every(([k, want]) => v.labels[k] === want),
  );
  return found?.value;
}

/**
 * Reads a histogram's `_sum` series. prom-client exposes a histogram as ONE
 * metric whose name has no suffix; the `_sum`/`_count`/`_bucket` series live
 * inside its values, tagged with `metricName`. Looking up `..._sum` as a
 * top-level metric name silently returns undefined.
 */
async function histogramSum(name: string, labels: Record<string, string> = {}) {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  if (!metric) return undefined;
  const found = (
    metric.values as { value: number; labels: Record<string, string>; metricName?: string }[]
  ).find(
    (v) =>
      v.metricName === `${name}_sum` &&
      Object.entries(labels).every(([k, want]) => v.labels[k] === want),
  );
  return found?.value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('refreshSqlGauges — empty windows', () => {
  it('reports fill rate 1, not 0, when no rides were requested', async () => {
    // At 4am there is no traffic. 0/0 is undefined, and reporting 0 would fire a
    // "fill rate collapsed" page every single night. The requested-count series
    // is what carries the "no traffic" signal.
    stubQueries({ window: { requested: '0', matched: '0', no_captain: '0', p50: null, p95: null } });

    await refreshSqlGauges();

    expect(await sample('tewiz_fill_rate_1h')).toBe(1);
    expect(await sample('tewiz_no_captain_rate_1h')).toBe(0);
  });

  it('computes fill rate and no-captain rate from the window counts', async () => {
    stubQueries({
      window: { requested: '20', matched: '15', no_captain: '4', p50: '18', p95: '72' },
    });

    await refreshSqlGauges();

    expect(await sample('tewiz_fill_rate_1h')).toBe(0.75);
    expect(await sample('tewiz_no_captain_rate_1h')).toBe(0.2);
    expect(await sample('tewiz_time_to_match_seconds_1h', { quantile: '0.5' })).toBe(18);
    expect(await sample('tewiz_time_to_match_seconds_1h', { quantile: '0.95' })).toBe(72);
  });
});

describe('refreshSqlGauges — supply', () => {
  it('separates advertised supply from usable supply', async () => {
    // A captain who is "online" with a 10-minute-old fix is invisible to dispatch
    // in practice. The gap between these two numbers is the one that explains
    // "we had captains online but nobody got matched".
    stubQueries({
      live: { searching: '7', online: '12', on_ride: '3', stale_location: '5' },
    });

    await refreshSqlGauges();

    expect(await sample('tewiz_rides_searching_now')).toBe(7);
    expect(await sample('tewiz_captains_online_now', { presence: 'online' })).toBe(12);
    expect(await sample('tewiz_captains_online_now', { presence: 'on_ride' })).toBe(3);
    expect(await sample('tewiz_captains_online_stale_location')).toBe(5);
  });
});

describe('refreshSqlGauges — per-zone series', () => {
  const nouakchottCentre = { lat: 18.0858, lng: -15.9785 };
  const nouakchottNorth = { lat: 18.1541, lng: -15.9382 };

  it('aggregates pickups into H3 cells and counts the unfilled ones', async () => {
    stubQueries({
      pickups: [
        { ...nouakchottCentre, unfilled: false },
        { ...nouakchottCentre, unfilled: true },
        { ...nouakchottCentre, unfilled: false },
      ],
    });

    await refreshSqlGauges();

    const metrics = await registry.getMetricsAsJSON();
    const requested = metrics.find((m) => m.name === 'tewiz_zone_rides_requested_1h');
    const unfilled = metrics.find((m) => m.name === 'tewiz_zone_rides_unfilled_1h');
    // Three pickups at the same coordinates must collapse into ONE series.
    expect(requested?.values).toHaveLength(1);
    expect(requested?.values[0]?.value).toBe(3);
    expect(unfilled?.values[0]?.value).toBe(1);
    // The label is an H3 index, not a coordinate — coordinates would be unbounded.
    expect(requested?.values[0]?.labels.h3).toMatch(/^[0-9a-f]{15}$/);
  });

  it('drops a zone that goes quiet instead of pinning its last value', async () => {
    stubQueries({ pickups: [{ ...nouakchottNorth, unfilled: true }] });
    await refreshSqlGauges();
    const before = await registry.getMetricsAsJSON();
    expect(before.find((m) => m.name === 'tewiz_zone_rides_requested_1h')?.values).toHaveLength(1);

    // Next hour: no rides from that zone at all.
    stubQueries({ pickups: [] });
    await refreshSqlGauges();

    const after = await registry.getMetricsAsJSON();
    // Without the reset, this zone would keep reporting 1 ride/hour forever and a
    // dashboard would show demand that does not exist.
    expect(after.find((m) => m.name === 'tewiz_zone_rides_requested_1h')?.values).toHaveLength(0);
  });

  it('keeps distinct zones as distinct series', async () => {
    stubQueries({
      pickups: [
        { ...nouakchottCentre, unfilled: false },
        { ...nouakchottNorth, unfilled: false },
      ],
    });

    await refreshSqlGauges();

    const metrics = await registry.getMetricsAsJSON();
    expect(metrics.find((m) => m.name === 'tewiz_zone_rides_requested_1h')?.values).toHaveLength(2);
  });
});

describe('refreshSqlGauges — money', () => {
  it('exposes the wallet ledger drift so it can be alerted on', async () => {
    // trg_wallet_balance_consistency should make this identically 0. A non-zero
    // sample means balances and the ledger disagree — captains being paid wrong.
    stubQueries({ money: { blocked: '4', drift: '2' } });

    await refreshSqlGauges();

    expect(await sample('tewiz_captains_blocked_low_balance')).toBe(4);
    expect(await sample('tewiz_wallet_ledger_drift_rows')).toBe(2);
  });
});

describe('backup gauges', () => {
  it('reports -1, not 0, when no dump directory exists', async () => {
    // 0 would read as "backed up this very second" — the most reassuring value for
    // the most alarming state. Alert on `< 0 or > 26h`.
    process.env.BACKUP_DIR = '/nonexistent/tewiz-db';
    process.env.WAL_ARCHIVE_DIR = '/nonexistent/tewiz-wal';
    stubQueries({});

    await refreshSqlGauges();

    expect(await sample('tewiz_db_backup_age_seconds')).toBe(-1);
    expect(await sample('tewiz_wal_archive_segments')).toBe(0);
    delete process.env.BACKUP_DIR;
    delete process.env.WAL_ARCHIVE_DIR;
  });

  it('reports the age of the newest dump and the pending WAL count', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dumpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tewiz-db-'));
    const walDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tewiz-wal-'));
    await fs.writeFile(path.join(dumpDir, 'tewiz-20260730T020000Z.dump'), 'x');
    // A non-matching file must be ignored, or a stray log would pass for a backup.
    await fs.writeFile(path.join(dumpDir, 'notes.txt'), 'x');
    await fs.writeFile(path.join(walDir, '000000010000000000000001.gz'), 'x');
    await fs.writeFile(path.join(walDir, '000000010000000000000002.gz'), 'x');
    process.env.BACKUP_DIR = dumpDir;
    process.env.WAL_ARCHIVE_DIR = walDir;
    stubQueries({});

    await refreshSqlGauges();

    const age = await sample('tewiz_db_backup_age_seconds');
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(60);
    expect(await sample('tewiz_wal_archive_segments')).toBe(2);

    delete process.env.BACKUP_DIR;
    delete process.env.WAL_ARCHIVE_DIR;
    await fs.rm(dumpDir, { recursive: true, force: true });
    await fs.rm(walDir, { recursive: true, force: true });
  });
});

describe('recordMatch', () => {
  it('observes time-to-match from the ride request timestamp', async () => {
    const before = (await sample('tewiz_rides_accepted_total', { ride_type: 'passenger' })) ?? 0;
    const requestedAt = new Date(Date.now() - 25_000);

    recordMatch('passenger', requestedAt);

    expect(await sample('tewiz_rides_accepted_total', { ride_type: 'passenger' })).toBe(before + 1);
    const sum = await histogramSum('tewiz_time_to_match_seconds', { ride_type: 'passenger' });
    expect(sum).toBeGreaterThanOrEqual(24);
    expect(sum).toBeLessThan(30);
  });

  it('still counts the match when requestedAt is missing', async () => {
    const before = (await sample('tewiz_rides_accepted_total', { ride_type: 'colis' })) ?? 0;

    recordMatch('colis', null);

    expect(await sample('tewiz_rides_accepted_total', { ride_type: 'colis' })).toBe(before + 1);
  });

  it('ignores a negative duration rather than corrupting the histogram', async () => {
    // A clock skew between the DB and the API, or a bad row, would otherwise add a
    // negative value to the histogram's sum — and a histogram cannot be corrected.
    const sumBefore =
      (await histogramSum('tewiz_time_to_match_seconds', { ride_type: 'private_driver' })) ?? 0;

    recordMatch('private_driver', new Date(Date.now() + 60_000));

    const sumAfter =
      (await histogramSum('tewiz_time_to_match_seconds', { ride_type: 'private_driver' })) ?? 0;
    expect(sumAfter).toBe(sumBefore);
    // The match itself is still counted — only the timing is discarded.
    expect(await sample('tewiz_rides_accepted_total', { ride_type: 'private_driver' })).toBe(1);
  });
});

describe('label cardinality', () => {
  it('keeps ride source and type as bounded labels', async () => {
    ridesRequested.inc({ ride_type: 'passenger', source: 'app' });
    ridesRequested.inc({ ride_type: 'passenger', source: 'app' });
    ridesRequested.inc({ ride_type: 'colis', source: 'restaurant' });

    const metrics = await registry.getMetricsAsJSON();
    const values = metrics.find((m) => m.name === 'tewiz_rides_requested_total')?.values ?? [];
    // Two distinct (type, source) pairs → two series, not three.
    expect(values).toHaveLength(2);
  });

  it('records accept-rejection reasons under their own label', async () => {
    rideAcceptRejected.inc({ reason: 'not_searching' });
    rideAcceptRejected.inc({ reason: 'balance_too_low' });
    rideAcceptRejected.inc({ reason: 'not_searching' });

    expect(await sample('tewiz_ride_accept_rejected_total', { reason: 'not_searching' })).toBe(2);
    expect(await sample('tewiz_ride_accept_rejected_total', { reason: 'balance_too_low' })).toBe(1);
  });
});

describe('exposition format', () => {
  it('renders a Prometheus text exposition with the service label', async () => {
    stubQueries({ live: { searching: '2', online: '5', on_ride: '1', stale_location: '0' } });
    await refreshSqlGauges();

    const text = await registry.metrics();

    expect(text).toContain('# TYPE tewiz_rides_searching_now gauge');
    expect(text).toContain('service="tewiz-api"');
    // Default Node metrics are prefixed too, so everything shares one namespace.
    expect(text).toMatch(/tewiz_(process|nodejs)_/);
  });
});
