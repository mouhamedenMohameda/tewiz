/**
 * Remote app configuration read from GET /public/config on every cold launch.
 *
 * Values are persisted to AsyncStorage so the last-known config is available
 * instantly on next launch (even offline). A network fetch always runs in the
 * background and overwrites the cache for the next launch.
 *
 * Fail-safe defaults (used when the API is unreachable and no cache exists):
 *   showDemoButtons: false  — demo buttons stay hidden for real users.
 *   modules.*: false        — admin-gated services stay hidden until the server
 *                             confirms they are enabled (fail-closed).
 */

import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

export type CaptainAlertSoundMode = 'standard' | 'critical';

const STORAGE_KEY = '@tewiz/app-config';

/**
 * Per-service availability flags, keyed by APP_MODULES key. Managed from the
 * admin settings screen. `false` means the admin turned the service off — the
 * home grid hides it. Utility modules (history, favorites, …) are not gated and
 * are simply absent from this map (treated as always available).
 */
export type ModuleFlags = Record<string, boolean>;

export interface AppConfig {
  showDemoButtons: boolean;
  captainAlertSoundMode: CaptainAlertSoundMode;
  captainAlertRepeatIntervalS: number;
  captainAlertSoundUrl: string | null;
  // Download links for the latest builds, shown at the bottom of the in-app
  // Settings screen. null = the corresponding button is hidden.
  latestAndroidUrl: string | null;
  latestIosUrl: string | null;
  modules: ModuleFlags;
}

// Fail-closed: every admin-gated module defaults to false so a service the
// admin disabled is never shown while we lack a fresh server confirmation.
const DEFAULT_MODULE_FLAGS: ModuleFlags = {
  carpooling: false,
  private_driver: false,
  convoyage: false,
  car_rental: false,
  roadside_assistance: false,
  light_moving: false,
  intercity_freight: false,
  equipment_rental: false,
};

const DEFAULTS: AppConfig = {
  showDemoButtons: false,
  captainAlertSoundMode: 'standard',
  captainAlertRepeatIntervalS: 2,
  captainAlertSoundUrl: null,
  latestAndroidUrl: null,
  latestIosUrl: null,
  modules: DEFAULT_MODULE_FLAGS,
};

let memCache: AppConfig | null = null;

// Subscribers are React hooks that want to be notified when the background
// network refresh finishes. Without this, a fresh install (no AsyncStorage
// cache) would render the DEFAULTS forever on the first launch — the reviewer
// one-tap demo buttons (gated on showDemoButtons) would stay hidden even though
// the server returns showDemoButtons: true. That was the Guideline 2.1 cause:
// the reviewer never saw the demo buttons and fell back to manual typing.
type Listener = (cfg: AppConfig) => void;
const listeners = new Set<Listener>();

function emit(cfg: AppConfig): void {
  for (const l of listeners) l(cfg);
}

// Dedupe concurrent background refreshes (welcome + login + root layout all
// trigger a load on launch). One in-flight fetch is enough.
let refreshing: Promise<void> | null = null;

function refreshInBackground(): void {
  if (refreshing) return;
  refreshing = (async () => {
    try {
      const fresh = await fetchRemote();
      memCache = fresh;
      await writeStorage(fresh);
      emit(fresh);
    } catch {
      // Network unavailable — keep the cached value.
    } finally {
      refreshing = null;
    }
  })();
}

// Merge a partial config (from the network or an older AsyncStorage cache that
// predates a field) onto the defaults. `modules` is merged key-by-key so a
// missing service flag falls back to its fail-closed default rather than
// leaving `modules` undefined.
function normalize(partial: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    ...DEFAULTS,
    ...partial,
    modules: { ...DEFAULT_MODULE_FLAGS, ...(partial?.modules ?? {}) },
  };
}

async function fetchRemote(): Promise<AppConfig> {
  const r = await api.get<Partial<AppConfig>>('/public/config');
  return normalize(r.data);
}

async function readStorage(): Promise<AppConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw) as Partial<AppConfig>);
  } catch {}
  return null;
}

async function writeStorage(cfg: AppConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

/**
 * Load the app config. Called once on app launch (from the root layout).
 * Returns immediately from memory → AsyncStorage → defaults (fast first paint),
 * then kicks off a background refresh that updates the cache AND notifies any
 * mounted `useAppConfig` hooks so the current launch reflects the server value
 * (critical on a fresh install where there is no cache yet).
 */
export async function loadAppConfig(): Promise<AppConfig> {
  const stored = memCache ?? (await readStorage());
  const initial = stored ?? DEFAULTS;
  memCache = initial;

  // Background refresh — does not block the caller, but does push the fresh
  // value to subscribers so the demo buttons appear on the very first launch.
  refreshInBackground();

  return initial;
}

/** Read the already-loaded config synchronously. Returns defaults if not yet loaded. */
export function getAppConfig(): AppConfig {
  return memCache ?? DEFAULTS;
}

/**
 * React hook — returns the app config and re-renders the component once the
 * async load completes. Use this in screens that need to react to the config
 * (e.g. show/hide demo buttons) rather than getAppConfig() which is
 * synchronous and may return stale defaults on first render.
 */
export function useAppConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(getAppConfig);

  useEffect(() => {
    let cancelled = false;

    // Reflect the (cached/default) value now, then subscribe so the fresh
    // network value updates this screen on the SAME launch — otherwise a
    // fresh install would keep rendering the defaults and never reveal the
    // reviewer demo buttons.
    const listener: Listener = (cfg) => {
      if (!cancelled) setConfig(cfg);
    };
    listeners.add(listener);

    loadAppConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return config;
}
