/**
 * La préférence de thème du Captain.
 *
 * Le point délicat n'est pas le choix lui-même, c'est QUAND il est lu. Le
 * ThemeProvider fixe la palette pendant le rendu — pas dans un effet — pour
 * qu'un démarrage à froid n'affiche jamais une image dans la mauvaise
 * palette. Une préférence lue de façon asynchrone après le premier rendu
 * annulerait ce soin. D'où `currentThemePreference()`, synchrone, alimentée
 * par `initThemePreference()` que app/_layout.tsx attend avant de peindre.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

import {
  THEME_PREFERENCES, currentThemePreference, initThemePreference,
  setThemePreference, __resetThemePreference,
} from '../lib/themePreference';

const KEY = '@tewiz/theme-preference';

beforeEach(() => {
  store.clear();
  __resetThemePreference();
  vi.clearAllMocks();
});

describe('themePreference', () => {
  it('démarre sur « système » quand rien n\'est stocké', async () => {
    expect(await initThemePreference()).toBe('system');
    expect(currentThemePreference()).toBe('system');
  });

  it('relit le choix du Captain au démarrage suivant', async () => {
    store.set(KEY, 'light');
    await initThemePreference();
    expect(currentThemePreference()).toBe('light');
  });

  it('retombe sur « système » devant une valeur inconnue', async () => {
    // Build plus ancien, stockage corrompu : mieux vaut le défaut qu'une
    // palette introuvable qui figerait l'app.
    store.set(KEY, 'solarized');
    await initThemePreference();
    expect(currentThemePreference()).toBe('system');
  });

  it('reste démarrable si le stockage est illisible', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disque hs'));
    expect(await initThemePreference()).toBe('system');
  });

  it('applique le choix immédiatement, sans attendre le disque', async () => {
    await initThemePreference();
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    let release: (() => void) | undefined;
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(
      (k: string, v: string) => new Promise((resolve) => {
        release = () => { store.set(k, v); resolve(undefined as never); };
      }),
    );

    // L'écriture est volontairement bloquée : la palette doit déjà avoir
    // changé. Sinon le Captain touche « Clair » et regarde un écran sombre
    // jusqu'à ce que le disque réponde.
    const pending = setThemePreference('dark');
    expect(currentThemePreference()).toBe('dark');
    expect(store.get(KEY)).toBeUndefined();

    release!();
    await pending;
    expect(store.get(KEY)).toBe('dark');
  });

  it("n'écrit pas quand le choix ne change pas", async () => {
    await initThemePreference();
    await setThemePreference('light');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(AsyncStorage.setItem).mockClear();
    await setThemePreference('light');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('un second init ne réécrase pas un choix déjà appliqué', async () => {
    // `initThemePreference` est idempotent : un remontage du layout ne doit
    // pas ramener la valeur du disque par-dessus ce que le Captain vient de
    // choisir dans cette session.
    store.set(KEY, 'light');
    await initThemePreference();
    await setThemePreference('dark');
    expect(await initThemePreference()).toBe('dark');
  });

  it('n\'expose que les trois choix proposés', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark']);
  });
});
