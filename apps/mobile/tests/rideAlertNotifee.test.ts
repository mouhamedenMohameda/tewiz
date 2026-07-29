/**
 * Regression test for the bug that silently killed the Android full-screen
 * "incoming ride" alert.
 *
 * Notifee's index exports the callable API as `default` but its enums
 * (AndroidImportance / AndroidCategory / AndroidVisibility) ONLY on the module
 * NAMESPACE:
 *
 *   exports.default = Object.assign(apiModule, { SDK_VERSION });
 *   __exportStar(require('./types/NotificationAndroid'), exports);
 *
 * Reading the enums off `.default` therefore yields undefined, so
 * `AndroidImportance.HIGH` threw a TypeError inside displayFullScreenRideAlert's
 * try/catch. On device the headless task ran and "finished" normally, the
 * `ride-fullscreen` channel was never created, nothing was posted and nothing
 * was logged — the captain simply never got an alert.
 *
 * buildFullScreenAlert is the pure payload builder, so the enum wiring is
 * pinned here without needing the native module: an `undefined` importance /
 * category / visibility now fails the suite instead of silently disabling ride
 * alerts in production.
 */
import { describe, expect, it, vi } from 'vitest';

// The module imports react-native (Flow syntax) and registers native side
// effects at load. Stub them; Platform=ios makes the module-level Notifee
// registration no-op. buildFullScreenAlert itself is pure and platform-agnostic.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({ registerTaskAsync: vi.fn() }));
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));

import { buildFullScreenAlert } from '../lib/fullScreenRideAlert';

/** Notifee's real export shape: enums on the namespace, API on `default`. */
const NOTIFEE_NAMESPACE = {
  default: { createChannel: () => {}, displayNotification: () => {} },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AndroidCategory: { CALL: 'call' },
  AndroidVisibility: { PUBLIC: 1 },
};

describe('buildFullScreenAlert — channel', () => {
  it('uses the real enum values from the namespace', () => {
    const { channel } = buildFullScreenAlert(NOTIFEE_NAMESPACE, { rideId: 'r1' });
    expect(channel.id).toBe('ride-fullscreen');
    expect(channel.importance).toBe(4); // was undefined → TypeError
    expect(channel.visibility).toBe(1);
    expect(channel.bypassDnd).toBe(true);
    expect(channel.sound).toBe('default');
  });
});

describe('buildFullScreenAlert — notification', () => {
  it('carries the fullScreenAction that takes over the lock screen', () => {
    const { notification } = buildFullScreenAlert(NOTIFEE_NAMESPACE, { rideId: 'r1' });
    const android = notification.android as Record<string, unknown>;
    expect(android.fullScreenAction).toEqual({ id: 'default', launchActivity: 'default' });
    expect(android.pressAction).toEqual({ id: 'default', launchActivity: 'default' });
    expect(android.category).toBe('call');
    expect(android.importance).toBe(4);
    expect(android.visibility).toBe(1);
    expect(android.channelId).toBe('ride-fullscreen');
    expect(android.lightUpScreen).toBe(true);
  });

  it('passes the ride payload through so the tap can route to the ride', () => {
    const { notification } = buildFullScreenAlert(NOTIFEE_NAMESPACE, {
      rideId: 'r9', title: 'T', body: 'B',
    });
    expect(notification.id).toBe('ride-r9');
    expect(notification.title).toBe('T');
    expect(notification.body).toBe('B');
    expect(notification.data).toMatchObject({ type: 'ride_alert', rideId: 'r9' });
  });

  it('falls back to default copy when the push carries no title/body', () => {
    const { notification } = buildFullScreenAlert(NOTIFEE_NAMESPACE, { rideId: 'r2' });
    expect(notification.title).toBeTruthy();
    expect(notification.body).toBeTruthy();
  });
});

describe('buildFullScreenAlert — resilience to the exact shipped bug', () => {
  // This is what the code used to pass in: the `.default` instance, which has
  // the API methods but NOT the enums.
  it('still produces a working alert when the enums are missing', () => {
    const { channel, notification } = buildFullScreenAlert(
      NOTIFEE_NAMESPACE.default,
      { rideId: 'r1' },
    );
    const android = notification.android as Record<string, unknown>;
    // Never undefined — undefined is what broke the native call.
    expect(channel.importance).toBe(4);
    expect(channel.visibility).toBe(1);
    expect(android.category).toBe('call');
    expect(android.fullScreenAction).toBeDefined();
  });

  it('tolerates a null/undefined module without throwing', () => {
    expect(() => buildFullScreenAlert(null, { rideId: 'r1' })).not.toThrow();
    expect(buildFullScreenAlert(undefined, { rideId: 'r1' }).channel.importance).toBe(4);
  });
});
