/**
 * FEATURE 17 — Tenir la charge.  ⚠️ FRAGILE BY DESIGN
 *
 * There is no realtime transport anywhere in the platform — no WebSocket, no
 * SSE, no long-poll. Every live surface is an interval timer hitting the API,
 * and the hottest of them (`captainInbox`) runs a PostGIS query with correlated
 * subqueries in its ORDER BY, on a box that shares CPU with Postgres.
 *
 * The request budget is therefore a product of two numbers that live in screen
 * files: how often each screen ticks, and how many people have it open. This
 * file pins the intervals so a casual "make it feel snappier" edit is a visible
 * decision with a computed cost, not a one-character diff.
 *
 * The server-side half of this feature — the cluster lock that lets the API run
 * more than one process — is covered by
 * apps/api/tests/features/17-crons-take-a-distributed-lock.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runGuarded, type Flag } from '../lib/pollGuard';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Pull the interval literals out of a screen's usePolling call. */
function pollIntervals(file: string): number[] {
  const src = read(file);
  const call = src.match(/usePolling\([\s\S]{0,200}?\);/g) ?? [];
  return call
    .flatMap((c) => c.match(/(\d[\d_]*)_000/g) ?? [])
    .map((m) => Number(m.replace(/_/g, '')));
}

describe('the platform has no realtime transport at all', () => {
  it('opens no WebSocket or SSE connection anywhere in the app', () => {
    // Pinned as a fact, not a preference. Every "live" behaviour below is a
    // consequence of this one architectural choice.
    const files = [
      'lib/api.ts', 'lib/usePolling.ts', 'lib/useApiQuery.ts', 'lib/queryClient.tsx',
      'app/(app)/rider/current.tsx', 'app/(app)/captain/rides.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/new WebSocket|socket\.io|EventSource|wss?:\/\//);
    }
  });
});

describe('the poll intervals that set the request budget', () => {
  it('ticks the captain ride screen every 3–8 s depending on state', () => {
    // 3 s while an open-ride meter runs, 8 s on an active ride, 5 s otherwise.
    // At 200 online captains the 5 s path alone is ~40 req/s of pure polling,
    // each running the heaviest query in the system.
    expect(pollIntervals('app/(app)/captain/rides.tsx').sort((a, b) => a - b))
      .toEqual([3000, 5000, 8000]);
  });

  it('ticks the rider tracking screen every 3–5 s', () => {
    expect(pollIntervals('app/(app)/rider/current.tsx').sort((a, b) => a - b))
      .toEqual([3000, 5000]);
  });

  it('keeps the captain dashboard and heatmap on slow intervals', () => {
    // These are the ones that got the calibration right: a heatmap recomputed
    // server-side every 5 min does not need a 5 s client poll.
    expect(pollIntervals('app/(app)/captain/index.tsx').sort((a, b) => a - b))
      .toEqual([30000, 60000]);
  });

  it('never polls faster than 3 s anywhere', () => {
    // A floor, deliberately. Below this the request cannot reliably complete on
    // a Mauritanian 2G link before the next tick is due, so the guard below
    // starts dropping ticks and the screen gets LESS live, not more.
    const screens = [
      'app/(app)/captain/rides.tsx', 'app/(app)/rider/current.tsx',
      'app/(app)/captain/index.tsx', 'app/(app)/rider/voice-ride.tsx',
    ];
    for (const s of screens) {
      for (const ms of pollIntervals(s)) expect(ms, s).toBeGreaterThanOrEqual(3000);
    }
  });
});

describe('polling stops when the screen is not visible', () => {
  it('scopes the interval to useFocusEffect', () => {
    const src = read('lib/usePolling.ts');

    // This is what makes the battery cost acceptable — and simultaneously what
    // makes features 4 and 7 broken: a rider who locks their phone stops
    // polling and, with no push, learns nothing until they look again.
    expect(src).toMatch(/useFocusEffect/);
    expect(src).toMatch(/clearInterval/);
  });

  it('pauses the query-based poller on blur and in the background', () => {
    const src = read('lib/useApiQuery.ts');

    expect(src).toMatch(/refetchInterval:\s*pollMs && focused \? pollMs : false/);
    expect(src).toMatch(/refetchIntervalInBackground:\s*false/);
  });
});

describe('the re-entrancy guard that keeps a slow network from stacking requests', () => {
  it('runs a tick when nothing is in flight', async () => {
    const flag: Flag = { current: false };
    const cb = vi.fn(async () => {});

    expect(await runGuarded(flag, cb)).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(flag.current).toBe(false);
  });

  it('drops a tick that arrives while the previous one is still pending', async () => {
    const flag: Flag = { current: false };
    let release!: () => void;
    const slow = vi.fn(() => new Promise<void>((r) => { release = r; }));

    const first = runGuarded(flag, slow);
    const second = await runGuarded(flag, slow);

    // On a 3 s interval over 2G, requests routinely outlive their tick. Without
    // this the client would pile a second, third and fourth request on top of a
    // request that has not answered — turning a slow network into a dead one.
    expect(second).toBe(false);
    expect(slow).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(flag.current).toBe(false);
  });

  it('clears the flag even when the tick throws, so polling cannot wedge', async () => {
    const flag: Flag = { current: false };

    await expect(runGuarded(flag, async () => { throw new Error('offline'); })).rejects.toThrow();

    // A single failed request must not stop the screen updating for the rest of
    // the session.
    expect(flag.current).toBe(false);
    expect(await runGuarded(flag, async () => {})).toBe(true);
  });
});

describe('the request budget scales with users, not with events', () => {
  it('computes what the current intervals cost at modest scale', () => {
    // Not an assertion about code — an assertion about arithmetic, kept next to
    // the numbers it depends on so it updates when they do.
    const captainInboxHz = 1 / 5;   // idle captain, 5 s
    const riderTrackHz = 1 / 5;     // rider watching a ride, 5 s
    const captains = 200;
    const riders = 200;

    const reqPerSec = captains * captainInboxHz + riders * riderTrackHz;

    // 80 req/s at 200+200 — before a single ride is actually created, and every
    // captain request runs the PostGIS dispatch query. A realtime transport
    // would make this proportional to EVENTS (a few per minute) instead of to
    // logged-in users.
    expect(reqPerSec).toBe(80);
    expect(reqPerSec).toBeGreaterThan(50);
  });
});
