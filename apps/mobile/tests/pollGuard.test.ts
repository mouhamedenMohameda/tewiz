/**
 * Locks the polling re-entrancy guard added ahead of the perf work: a slow
 * tick must not let the next interval tick fire a second overlapping request,
 * and a throwing tick must not wedge polling forever.
 */
import { describe, expect, it, vi } from 'vitest';
import { runGuarded, type Flag } from '../lib/pollGuard';

/** A promise whose resolution we control, to hold a tick "in flight". */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('runGuarded', () => {
  it('runs the callback and clears the flag when nothing is in flight', async () => {
    const flag: Flag = { current: false };
    const cb = vi.fn(async () => {});
    const ran = await runGuarded(flag, cb);
    expect(ran).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(flag.current).toBe(false);
  });

  it('drops an overlapping tick while one is still in flight', async () => {
    const flag: Flag = { current: false };
    const d = deferred();
    const slow = vi.fn(() => d.promise);

    const first = runGuarded(flag, slow); // takes the lock, awaits the slow cb
    expect(flag.current).toBe(true);

    const second = await runGuarded(flag, slow); // in flight → skipped
    expect(second).toBe(false);
    expect(slow).toHaveBeenCalledTimes(1);

    d.resolve();
    expect(await first).toBe(true);
    expect(flag.current).toBe(false);
  });

  it('lets a later tick run once the in-flight one settles', async () => {
    const flag: Flag = { current: false };
    const d = deferred();
    const first = runGuarded(flag, () => d.promise);
    await runGuarded(flag, vi.fn()); // skipped while first is pending
    d.resolve();
    await first;

    const later = vi.fn(async () => {});
    expect(await runGuarded(flag, later)).toBe(true);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('clears the flag even when the callback throws', async () => {
    const flag: Flag = { current: false };
    await expect(runGuarded(flag, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(flag.current).toBe(false);
  });
});
