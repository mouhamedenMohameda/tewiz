/**
 * Locks the Android "incoming ride" push-payload parser (extractRideAlert).
 *
 * A killed/backgrounded app receives the ride alert as a *data-only* FCM push,
 * and expo-notifications hands the headless task the payload in several shapes
 * across platforms / SDK versions — sometimes as nested objects, sometimes as a
 * JSON *string* under data.dataString / data.body. If the parser misses the
 * real shape, the captain gets NO full-screen alert. These tests pin every
 * shape we've seen plus the rejection cases (wrong type, junk, missing).
 */
import { describe, expect, it, vi } from 'vitest';

// The module runs side effects at import (TaskManager.defineTask + a Notifee
// background-event registration guarded to Android). Stub the native surface;
// Platform=ios makes the Notifee IIFE no-op cleanly.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({ registerTaskAsync: vi.fn() }));
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));

import {
  extractRideAlert,
  displayFullScreenRideAlert,
  registerBackgroundRideAlertTask,
} from '../lib/fullScreenRideAlert';

const RIDE = { type: 'ride_alert', rideId: 'ride-123', title: 'T', body: 'B' };

describe('extractRideAlert — accepted shapes', () => {
  it('reads notification.request.content.data (foreground shape)', () => {
    expect(extractRideAlert({ notification: { request: { content: { data: RIDE } } } }))
      .toEqual({ rideId: 'ride-123', title: 'T', body: 'B' });
  });

  it('reads notification.data', () => {
    expect(extractRideAlert({ notification: { data: RIDE } })?.rideId).toBe('ride-123');
  });

  it('reads a nested data object', () => {
    expect(extractRideAlert({ data: RIDE })?.rideId).toBe('ride-123');
  });

  it('reads a top-level payload', () => {
    expect(extractRideAlert(RIDE)?.rideId).toBe('ride-123');
  });

  it('parses a JSON string under data.dataString (the real killed-app path)', () => {
    expect(extractRideAlert({ data: { dataString: JSON.stringify(RIDE) } })?.rideId).toBe('ride-123');
  });

  it('parses a JSON string under data.body', () => {
    expect(extractRideAlert({ data: { body: JSON.stringify(RIDE) } })?.rideId).toBe('ride-123');
  });

  it('parses a top-level dataString', () => {
    expect(extractRideAlert({ dataString: JSON.stringify(RIDE) })?.rideId).toBe('ride-123');
  });

  it('keeps rideId undefined (but still matches) when it is not a string', () => {
    const r = extractRideAlert({ type: 'ride_alert', rideId: 42 });
    expect(r).not.toBeNull();
    expect(r?.rideId).toBeUndefined();
  });

  it('omits title/body when absent', () => {
    expect(extractRideAlert({ type: 'ride_alert', rideId: 'x' })).toEqual({
      rideId: 'x', title: undefined, body: undefined,
    });
  });
});

describe('extractRideAlert — rejected shapes', () => {
  it('returns null for a different notification type', () => {
    expect(extractRideAlert({ type: 'chat_message', rideId: 'x' })).toBeNull();
  });

  it('returns null for a non-JSON string body', () => {
    expect(extractRideAlert({ data: { body: 'just a heads-up banner' } })).toBeNull();
  });

  it('returns null for junk / empty / nullish input', () => {
    expect(extractRideAlert(undefined)).toBeNull();
    expect(extractRideAlert(null)).toBeNull();
    expect(extractRideAlert({})).toBeNull();
    expect(extractRideAlert('nope')).toBeNull();
    expect(extractRideAlert(123)).toBeNull();
  });
});

describe('platform guards', () => {
  it('displayFullScreenRideAlert no-ops off Android without throwing', async () => {
    await expect(displayFullScreenRideAlert({ rideId: 'x' })).resolves.toBeUndefined();
  });

  it('registerBackgroundRideAlertTask no-ops off Android without throwing', async () => {
    await expect(registerBackgroundRideAlertTask()).resolves.toBeUndefined();
  });
});
