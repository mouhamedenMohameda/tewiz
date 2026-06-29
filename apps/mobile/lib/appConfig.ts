/**
 * Remote app configuration read from GET /public/config on every cold launch.
 *
 * Values are persisted to AsyncStorage so the last-known config is available
 * instantly on next launch (even offline). A network fetch always runs in the
 * background and overwrites the cache for the next launch.
 *
 * Fail-safe defaults (used when the API is unreachable and no cache exists):
 *   showDemoButtons: false  — demo buttons stay hidden for real users.
 */

import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const STORAGE_KEY = '@tewiz/app-config';

export interface AppConfig {
  showDemoButtons: boolean;
}

const DEFAULTS: AppConfig = {
  showDemoButtons: false,
};

let memCache: AppConfig | null = null;

async function fetchRemote(): Promise<AppConfig> {
  const r = await api.get<AppConfig>('/public/config');
  return { ...DEFAULTS, ...r.data };
}

async function readStorage(): Promise<AppConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppConfig;
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
 * then kicks off a background refresh that updates the cache for the next use.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  if (memCache) return memCache;

  const stored = await readStorage();
  const initial = stored ?? DEFAULTS;
  memCache = initial;

  // Background refresh — does not block the caller.
  void (async () => {
    try {
      const fresh = await fetchRemote();
      memCache = fresh;
      await writeStorage(fresh);
    } catch {
      // Network unavailable — keep the cached value.
    }
  })();

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
    loadAppConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => { cancelled = true; };
  }, []);

  return config;
}
