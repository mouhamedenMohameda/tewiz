/**
 * Locks the iOS Live Activity logic that drives the "course en cours" card on
 * the lock screen / Dynamic Island. Two pure surfaces are pinned here:
 *
 *   1. buildState / buildTitle — the ride → rendered-strings mapping. The Swift
 *      widget is a dumb renderer, so every branch (open vs closed fare, live
 *      meter, per-type dropoff, fallbacks) must be resolved here correctly.
 *   2. decideLiveActivityAction — the start/update/end/none reducer. This is
 *      what guarantees the card appears, refreshes and disappears "under all
 *      conditions": ride swaps, terminal states, unchanged polls, etc.
 *
 * i18n is stubbed to echo the key so assertions don't couple to translations;
 * fares use the real formatMru so the numeric formatting is genuinely covered.
 */
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// The module pulls in Platform + the optional native module + i18n. None are
// exercised by the pure functions, so stub them to the minimum that imports.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('../lib/i18n', () => ({ i18n: { t: (k: string) => k } }));

import {
  buildState,
  buildTitle,
  decideLiveActivityAction,
  EMPTY_TRACKER,
  type LiveActivityRide,
} from '../lib/liveActivity';
import { formatMru } from '../lib/format';

function ride(over: Partial<LiveActivityRide> = {}): LiveActivityRide {
  return {
    id: 'r1',
    rideType: 'passenger',
    status: 'accepted',
    isOpen: false,
    pickup: { label: 'Aéroport' },
    dropoff: { label: 'Ksar' },
    fareEstimateMru: 1200,
    liveMeter: null,
    ...over,
  };
}

describe('buildTitle', () => {
  it('maps each ride type to its header, defaulting for unknown', () => {
    expect(buildTitle(ride({ rideType: 'passenger' }))).toBe('🚖 Course');
    expect(buildTitle(ride({ rideType: 'colis' }))).toBe('📦 Colis');
    expect(buildTitle(ride({ rideType: 'private_driver' }))).toBe('🕐 Captain Privé');
    expect(buildTitle(ride({ rideType: 'convoyage' }))).toBe('🚗 Convoyage');
    // Defensive default if a new type reaches the widget before its label exists.
    expect(buildTitle(ride({ rideType: 'anything' as LiveActivityRide['rideType'] }))).toBe('🚖 Course');
  });
});

describe('buildState', () => {
  it('carries the raw status as phase and labels the active steps', () => {
    expect(buildState(ride({ status: 'accepted' })).phase).toBe('accepted');
    expect(buildState(ride({ status: 'accepted' })).statusLabel).toBe('captain.rides.stepLabel.accepted');
    expect(buildState(ride({ status: 'in_progress' })).statusLabel).toBe('captain.rides.stepLabel.in_progress');
  });

  it('falls back to the raw status label for non-active states', () => {
    expect(buildState(ride({ status: 'completed' })).statusLabel).toBe('completed');
  });

  it('uses the estimate fare for closed rides', () => {
    expect(buildState(ride({ isOpen: false, fareEstimateMru: 1200 })).fare).toBe(formatMru(1200));
  });

  it('uses the live meter fare for open rides, and — when the meter is empty', () => {
    expect(buildState(ride({ isOpen: true, liveMeter: { fareMru: 850 } })).fare).toBe(formatMru(850));
    expect(buildState(ride({ isOpen: true, liveMeter: null })).fare).toBe('—');
  });

  it('shows "—" when a closed ride has no estimate', () => {
    expect(buildState(ride({ isOpen: false, fareEstimateMru: null })).fare).toBe('—');
  });

  it('uses the pickup/dropoff labels verbatim when present', () => {
    const s = buildState(ride({ pickup: { label: 'Aéroport' }, dropoff: { label: 'Ksar' } }));
    expect(s.pickup).toBe('Aéroport');
    expect(s.dropoff).toBe('Ksar');
  });

  it('falls back to a generic label when an endpoint has none', () => {
    const s = buildState(ride({ pickup: { label: null }, dropoff: { label: null } }));
    expect(s.pickup).toBe('captain.rides.pickupFallback');
    expect(s.dropoff).toBe('captain.rides.dropoffFallback');
  });

  it('shows the open-destination label for private_driver and open rides', () => {
    expect(buildState(ride({ rideType: 'private_driver' })).dropoff).toBe('captain.rides.openDestinationShort');
    expect(buildState(ride({ isOpen: true, dropoff: null })).dropoff).toBe('captain.rides.openDestinationShort');
  });
});

describe('decideLiveActivityAction', () => {
  it('does nothing when there is no ride and none is shown', () => {
    const { action, next } = decideLiveActivityAction(EMPTY_TRACKER, null);
    expect(action.kind).toBe('none');
    expect(next).toBe(EMPTY_TRACKER);
  });

  it('does nothing for a terminal ride when none is shown', () => {
    const { action } = decideLiveActivityAction(EMPTY_TRACKER, ride({ status: 'completed' }));
    expect(action.kind).toBe('none');
  });

  it('starts when the first active ride appears', () => {
    const { action, next } = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A' }));
    expect(action.kind).toBe('start');
    expect(next.shownRideId).toBe('A');
    expect(next.lastContent).not.toBe('');
  });

  it('does nothing when the same ride polls unchanged', () => {
    const first = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A' }));
    const { action } = decideLiveActivityAction(first.next, ride({ id: 'A' }));
    expect(action.kind).toBe('none');
  });

  it('updates when the same ride changes phase', () => {
    const first = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A', status: 'accepted' }));
    const { action, next } = decideLiveActivityAction(first.next, ride({ id: 'A', status: 'in_progress' }));
    expect(action.kind).toBe('update');
    expect(next.lastContent).not.toBe(first.next.lastContent);
  });

  it('updates when only the fare changes (open ride meter ticks)', () => {
    const base = ride({ id: 'A', isOpen: true, liveMeter: { fareMru: 100 } });
    const first = decideLiveActivityAction(EMPTY_TRACKER, base);
    const { action } = decideLiveActivityAction(first.next, { ...base, liveMeter: { fareMru: 250 } });
    expect(action.kind).toBe('update');
  });

  it('starts the new ride on a ride swap (native start ends the old one)', () => {
    const first = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A' }));
    const { action, next } = decideLiveActivityAction(first.next, ride({ id: 'B' }));
    expect(action.kind).toBe('start');
    expect(next.shownRideId).toBe('B');
  });

  it('ends when the active ride becomes terminal', () => {
    const first = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A', status: 'in_progress' }));
    const { action, next } = decideLiveActivityAction(first.next, ride({ id: 'A', status: 'completed' }));
    expect(action.kind).toBe('end');
    expect(next.shownRideId).toBeNull();
  });

  it('ends when the ride disappears entirely', () => {
    const first = decideLiveActivityAction(EMPTY_TRACKER, ride({ id: 'A' }));
    const { action, next } = decideLiveActivityAction(first.next, null);
    expect(action.kind).toBe('end');
    expect(next.shownRideId).toBeNull();
  });
});
