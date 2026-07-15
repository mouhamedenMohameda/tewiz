import { describe, expect, it, vi } from 'vitest';
import { instrumentQuery, normalizeSql } from '../src/lib/query-timing.js';

describe('normalizeSql', () => {
  it('collapses whitespace to a single line', () => {
    expect(normalizeSql('SELECT *\n  FROM users\n  WHERE id = $1')).toBe(
      'SELECT * FROM users WHERE id = $1',
    );
  });

  it('reads the .text field of a QueryConfig object', () => {
    expect(normalizeSql({ text: 'SELECT 1' })).toBe('SELECT 1');
  });

  it('truncates very long SQL with an ellipsis', () => {
    const long = `SELECT ${'a'.repeat(400)}`;
    const out = normalizeSql(long, 300);
    expect(out.length).toBe(301); // 300 chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('instrumentQuery', () => {
  // A controllable clock so tests don't depend on real elapsed time.
  function fakeClock(startAt = 0) {
    let t = startAt;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
  }

  it('reports a query that meets the threshold, with normalized SQL', async () => {
    const clock = fakeClock();
    const onSlow = vi.fn();
    const raw = vi.fn(async () => { clock.advance(250); return { rows: [] }; });

    const query = instrumentQuery(raw, { thresholdMs: 200, onSlow, now: clock.now });
    const res = await query('SELECT *   FROM rides');

    expect(res).toEqual({ rows: [] }); // result passes through untouched
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSlow).toHaveBeenCalledWith({ ms: 250, sql: 'SELECT * FROM rides' });
  });

  it('stays silent for a query under the threshold', async () => {
    const clock = fakeClock();
    const onSlow = vi.fn();
    const raw = vi.fn(async () => { clock.advance(40); return { rows: [] }; });

    const query = instrumentQuery(raw, { thresholdMs: 200, onSlow, now: clock.now });
    await query('SELECT 1');

    expect(onSlow).not.toHaveBeenCalled();
  });

  it('still times (and can report) a query that throws', async () => {
    const clock = fakeClock();
    const onSlow = vi.fn();
    const raw = vi.fn(async () => { clock.advance(300); throw new Error('boom'); });

    const query = instrumentQuery(raw, { thresholdMs: 200, onSlow, now: clock.now });
    await expect(query('UPDATE rides SET x = 1')).rejects.toThrow('boom');
    expect(onSlow).toHaveBeenCalledWith({ ms: 300, sql: 'UPDATE rides SET x = 1' });
  });

  it('passes params through and never logs them', async () => {
    const clock = fakeClock();
    const onSlow = vi.fn();
    const raw = vi.fn(async () => { clock.advance(500); return { rows: [] }; });

    const query = instrumentQuery(raw, { thresholdMs: 200, onSlow, now: clock.now });
    await query('SELECT * FROM users WHERE phone = $1', ['+22200000000']);

    expect(raw).toHaveBeenCalledWith('SELECT * FROM users WHERE phone = $1', ['+22200000000']);
    // The slow report carries SQL text only — no parameter values.
    expect(onSlow.mock.calls[0][0]).toEqual({ ms: 500, sql: 'SELECT * FROM users WHERE phone = $1' });
  });

  it('returns the original function unchanged when timing is disabled (threshold 0)', () => {
    const onSlow = vi.fn();
    const raw = vi.fn(async () => ({ rows: [] }));
    const query = instrumentQuery(raw, { thresholdMs: 0, onSlow });
    expect(query).toBe(raw);
  });
});
