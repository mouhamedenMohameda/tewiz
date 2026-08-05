/**
 * FEATURE 6 — le captain se fait guider au ramassage.
 *
 * WHAT MUST HOLD
 *
 *   1. The captain ride screen offers an action that hands the current leg to a
 *      real navigation app.
 *   2. It uses the platform's native handoff — `google.navigation:` on Android,
 *      `maps://` on iOS — with an https://www.google.com/maps/dir/ fallback so
 *      a phone without either still opens something.
 *   3. It navigates to the PICKUP while heading there, and to the DROPOFF once
 *      the passenger is aboard.
 *   4. It passes coordinates, never the rider's label.
 *
 * This file originally scanned the screen's source for URL literals, and said
 * in its own note that the URL building should be extracted into a module and
 * these replaced with unit tests of it. That is what happened: the logic lives
 * in `lib/navigation.ts`, tested properly below, and the screen keeps one
 * assertion that it actually wires it up.
 *
 * Regexes over a .tsx file could only ever prove a string was present. These
 * prove the right URL is produced for the right leg on the right platform.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { linkingMock, platform } = vi.hoisted(() => ({
  linkingMock: { openURL: vi.fn(async () => {}), canOpenURL: vi.fn(async () => true) },
  platform: { OS: 'android' as string },
}));

vi.mock('react-native', () => ({ Linking: linkingMock, Platform: platform }));

import {
  nativeNavigationUrl,
  navigationTargetForRide,
  openNavigation,
  webDirectionsUrl,
} from '../lib/navigation';

const PICKUP = { lat: 18.0858, lng: -15.9785, label: 'Marché Capitale' };
const DROPOFF = { lat: 18.1012, lng: -15.9503, label: 'Tevragh Zeina' };

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'android';
  linkingMock.canOpenURL.mockResolvedValue(true);
});

describe('the URL handed to the navigation app', () => {
  it('starts turn-by-turn directly on Android', () => {
    platform.OS = 'android';

    // `google.navigation:` begins guidance immediately. A plain maps URL drops
    // the driver on a preview screen they have to tap through while holding the
    // wheel — which is exactly when you do not want an extra tap.
    expect(nativeNavigationUrl(PICKUP)).toBe('google.navigation:q=18.0858,-15.9785&mode=d');
  });

  it('uses the Apple Maps scheme on iOS', () => {
    platform.OS = 'ios';

    expect(nativeNavigationUrl(PICKUP)).toBe('maps://?daddr=18.0858,-15.9785&dirflg=d');
  });

  it('always has an https fallback that resolves anywhere', () => {
    expect(webDirectionsUrl(PICKUP))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=18.0858,-15.9785');
  });

  it('carries coordinates, never the rider label', () => {
    // "chez moi" geocodes to nothing. The lat/lng is what the rider actually
    // pinned, and it is already on the ride object.
    for (const url of [nativeNavigationUrl(PICKUP), webDirectionsUrl(PICKUP)]) {
      expect(url).toContain('18.0858');
      expect(url).toContain('-15.9785');
      expect(url).not.toContain('Marché');
    }
  });
});

describe('opening navigation', () => {
  it('opens the native app when it can answer', async () => {
    await openNavigation(PICKUP);

    expect(linkingMock.openURL).toHaveBeenCalledWith('google.navigation:q=18.0858,-15.9785&mode=d');
  });

  it('falls back to the web URL when nothing handles the scheme', async () => {
    // A google.navigation: intent on a phone with no Google Maps silently does
    // NOTHING — to the captain that looks like a broken button.
    linkingMock.canOpenURL.mockResolvedValue(false);

    await openNavigation(PICKUP);

    expect(linkingMock.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=18.0858,-15.9785',
    );
  });

  it('falls back when canOpenURL itself throws', async () => {
    // Some Android configurations refuse to answer canOpenURL unless the scheme
    // is declared in the manifest. A throw must not leave a dead button.
    linkingMock.canOpenURL.mockRejectedValue(new Error('scheme not declared'));

    await openNavigation(PICKUP);

    expect(linkingMock.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps/dir'));
  });
});

describe('which end of the trip to navigate to', () => {
  it('targets the pickup while heading to the rider', () => {
    for (const status of ['accepted', 'arrived']) {
      expect(navigationTargetForRide({ status, pickup: PICKUP, dropoff: DROPOFF }))
        .toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
    }
  });

  it('switches to the destination once the passenger is aboard', () => {
    expect(navigationTargetForRide({ status: 'in_progress', pickup: PICKUP, dropoff: DROPOFF }))
      .toMatchObject({ lat: DROPOFF.lat, lng: DROPOFF.lng });
  });

  it('offers nothing for an open ride under way', () => {
    // An open ride has no destination by definition — the captain decides where
    // it ends. Better no button than a button that goes nowhere.
    expect(navigationTargetForRide({ status: 'in_progress', pickup: PICKUP, dropoff: null }))
      .toBeNull();
  });

  it('still offers the pickup for an open ride not yet started', () => {
    expect(navigationTargetForRide({ status: 'accepted', pickup: PICKUP, dropoff: null }))
      .toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
  });
});

describe('the screen wires it up', () => {
  it('calls the navigation module from the captain ride screen', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const src = readFileSync(resolve(root, 'app/(app)/captain/rides.tsx'), 'utf8');

    // The one thing unit tests of the module cannot prove: that anything calls it.
    expect(src).toMatch(/from '@\/lib\/navigation'/);
    expect(src).toMatch(/openNavigation\(/);
    expect(src).toMatch(/navigationTargetForRide\(/);
  });
});
