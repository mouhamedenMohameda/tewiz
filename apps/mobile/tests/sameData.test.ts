/**
 * Locks the polling re-render bail-out. The critical guarantee is REFERENCE
 * identity: when the polled payload is unchanged, the updater must return the
 * exact previous object so React's Object.is check skips the render. If it ever
 * returned a structurally-equal-but-new object, the optimization silently dies.
 */
import { describe, expect, it } from 'vitest';
import { jsonEqual, keepIfEqual } from '../lib/sameData';

describe('jsonEqual', () => {
  it('is true for the same reference and for structurally equal values', () => {
    const r = { id: 'r1' };
    expect(jsonEqual(r, r)).toBe(true);
    expect(jsonEqual({ id: 'r1', s: 'accepted' }, { id: 'r1', s: 'accepted' })).toBe(true);
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
  });

  it('is false when content differs', () => {
    expect(jsonEqual({ s: 'accepted' }, { s: 'arrived' })).toBe(false);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual(null, { id: 'r1' })).toBe(false);
  });
});

describe('keepIfEqual', () => {
  it('returns the PREVIOUS reference when structurally equal (React bails out)', () => {
    const prev = { id: 'r1', status: 'accepted' };
    const next = { id: 'r1', status: 'accepted' }; // equal content, new reference
    expect(keepIfEqual(next)(prev)).toBe(prev); // identity, not just equality
  });

  it('returns the NEXT value when the content changed', () => {
    const prev = { id: 'r1', status: 'accepted' };
    const next = { id: 'r1', status: 'arrived' };
    expect(keepIfEqual(next)(prev)).toBe(next);
  });

  it('bails out on unchanged empty arrays and nulls (idle inbox / no current ride)', () => {
    const prevInbox: unknown[] = [];
    expect(keepIfEqual<unknown[]>([])(prevInbox)).toBe(prevInbox);
    const prevRide = null;
    expect(keepIfEqual(null)(prevRide)).toBe(prevRide);
  });
});
