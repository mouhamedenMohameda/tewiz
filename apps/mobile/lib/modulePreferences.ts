import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { APP_MODULES } from './modules';

const STORAGE_KEY = '@module_preferences';

type ModulePrefs = Record<string, boolean>;

let current: ModulePrefs = {};
let loaded = false;
const listeners = new Set<(p: ModulePrefs) => void>();

function notify() {
  listeners.forEach((fn) => fn({ ...current }));
}

async function init(): Promise<ModulePrefs> {
  if (loaded) return current;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  current = raw ? JSON.parse(raw) : {};
  loaded = true;
  return current;
}

async function set(key: string, value: boolean) {
  current = { ...current, [key]: value };
  notify();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function useModulePreferences() {
  const [prefs, setPrefs] = useState<ModulePrefs>(current);
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    init().then((p) => { setPrefs(p); setReady(true); });
    listeners.add(setPrefs);
    return () => { listeners.delete(setPrefs); };
  }, []);

  const isEnabled = useCallback((key: string) => {
    return prefs[key] !== false;
  }, [prefs]);

  const toggle = useCallback(async (key: string, value: boolean) => {
    await set(key, value);
  }, []);

  const enabledModules = APP_MODULES.filter((m) => prefs[m.key] !== false);

  return { ready, prefs, isEnabled, toggle, enabledModules };
}
