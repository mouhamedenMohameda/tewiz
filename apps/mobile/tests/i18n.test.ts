/**
 * Regression tests for the i18n bootstrap — above all the layout-direction
 * rules. The home header ("Bonjour <name>") and the hero title ("Commander
 * une course") used to jump between LTR and RTL mid-session because
 * setLanguage() called I18nManager.forceRTL() while the app kept running:
 * only the views created afterwards pick up the new direction, so the UI
 * ends up half-mirrored.
 *
 * Invariant pinned here: whenever the native direction is flipped outside of
 * boot (setLanguage), the JS bundle MUST reload in the same breath so the
 * whole tree rebuilds in one consistent direction. A direction flip without
 * a reload is the bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.stubGlobal('__DEV__', true);

vi.mock('react-native', () => ({
  I18nManager: {
    isRTL: false,
    allowRTL: vi.fn(),
    forceRTL: vi.fn(),
    swapLeftAndRightInRTL: vi.fn(),
  },
  DevSettings: { reload: vi.fn() },
  NativeModules: { SettingsManager: { settings: { AppleLocale: 'fr_FR' } } },
  Platform: { OS: 'ios' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: async (k: string) => {
      storage.delete(k);
    },
  },
}));

const STORAGE_KEY = '@tewiz/language';

type I18nModule = typeof import('../lib/i18n');
interface MockedI18nManager {
  isRTL: boolean;
  allowRTL: ReturnType<typeof vi.fn>;
  forceRTL: ReturnType<typeof vi.fn>;
  swapLeftAndRightInRTL: ReturnType<typeof vi.fn>;
}
interface MockedDevSettings {
  reload: ReturnType<typeof vi.fn>;
}

/**
 * Fresh copy of lib/i18n per test — the module memoizes initI18n(), and each
 * test needs to control the pre-boot native direction.
 */
async function bootModule(opts?: { storedLanguage?: string; nativeRTL?: boolean }) {
  vi.resetModules();
  storage.clear();
  if (opts?.storedLanguage) storage.set(STORAGE_KEY, opts.storedLanguage);
  const { I18nManager, DevSettings } = (await import('react-native')) as unknown as {
    I18nManager: MockedI18nManager;
    DevSettings: MockedDevSettings;
  };
  I18nManager.isRTL = opts?.nativeRTL ?? false;
  I18nManager.allowRTL.mockClear();
  I18nManager.forceRTL.mockClear();
  DevSettings.reload.mockClear();
  DevSettings.reload.mockImplementation(() => {});
  const mod: I18nModule = await import('../lib/i18n');
  return { mod, I18nManager, DevSettings };
}

beforeEach(() => {
  storage.clear();
});

describe('isRTL', () => {
  it('flags only Arabic-script languages as RTL', async () => {
    const { mod } = await bootModule();
    expect(mod.isRTL('ar')).toBe(true);
    expect(mod.isRTL('hs')).toBe(true);
    for (const lang of ['fr', 'en', 'ff', 'wo', 'snk'] as const) {
      expect(mod.isRTL(lang)).toBe(false);
    }
  });
});

describe('applyLayoutDirection (boot-time only)', () => {
  it('is a no-op when the native direction already matches', async () => {
    const { mod, I18nManager } = await bootModule({ nativeRTL: false });
    expect(mod.applyLayoutDirection('fr')).toBe(false);
    expect(I18nManager.allowRTL).not.toHaveBeenCalled();
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  });

  it('flips the native direction when it differs', async () => {
    const { mod, I18nManager } = await bootModule({ nativeRTL: false });
    expect(mod.applyLayoutDirection('ar')).toBe(true);
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });

  it('restores LTR when the language went back to French', async () => {
    const { mod, I18nManager } = await bootModule({ nativeRTL: true });
    expect(mod.applyLayoutDirection('fr')).toBe(true);
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
  });
});

describe('initI18n', () => {
  it('applies the stored language direction before resolving (pre-paint)', async () => {
    const { mod, I18nManager } = await bootModule({ storedLanguage: 'ar', nativeRTL: false });
    await mod.initI18n();
    expect(I18nManager.forceRTL).toHaveBeenCalledTimes(1);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(mod.i18n.language).toBe('ar');
  });

  it('boots in French without touching an already-LTR layout', async () => {
    const { mod, I18nManager } = await bootModule({ storedLanguage: 'fr', nativeRTL: false });
    await mod.initI18n();
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(mod.i18n.language).toBe('fr');
  });
});

describe('setLanguage', () => {
  it('flips the direction AND reloads the bundle in the same breath (fr → ar)', async () => {
    const { mod, I18nManager, DevSettings } = await bootModule({
      storedLanguage: 'fr',
      nativeRTL: false,
    });
    await mod.initI18n();
    I18nManager.allowRTL.mockClear();
    I18nManager.forceRTL.mockClear();

    const { needsRestart } = await mod.setLanguage('ar');

    // A forceRTL without an immediate reload half-mirrors the mounted UI —
    // the two must always happen together.
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(DevSettings.reload).toHaveBeenCalledTimes(1);
    // Reload succeeded → no manual restart to ask for; the choice is
    // persisted so the next boot repaints in RTL from the first frame.
    expect(needsRestart).toBe(false);
    expect(storage.get(STORAGE_KEY)).toBe('ar');
  });

  it('same contract when leaving Arabic for French on an RTL layout', async () => {
    const { mod, I18nManager, DevSettings } = await bootModule({
      storedLanguage: 'ar',
      nativeRTL: true,
    });
    await mod.initI18n();
    I18nManager.allowRTL.mockClear();
    I18nManager.forceRTL.mockClear();

    const { needsRestart } = await mod.setLanguage('fr');

    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(DevSettings.reload).toHaveBeenCalledTimes(1);
    expect(needsRestart).toBe(false);
    expect(storage.get(STORAGE_KEY)).toBe('fr');
  });

  it('falls back to asking for a manual restart when no reload mechanism works', async () => {
    const { mod, I18nManager, DevSettings } = await bootModule({
      storedLanguage: 'fr',
      nativeRTL: false,
    });
    await mod.initI18n();
    DevSettings.reload.mockImplementation(() => {
      throw new Error('unavailable');
    });

    const { needsRestart } = await mod.setLanguage('ar');

    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(needsRestart).toBe(true);
    expect(mod.i18n.language).toBe('ar');
  });

  it('neither flips nor reloads when the direction is unchanged (fr → en)', async () => {
    const { mod, I18nManager, DevSettings } = await bootModule({
      storedLanguage: 'fr',
      nativeRTL: false,
    });
    await mod.initI18n();
    const { needsRestart } = await mod.setLanguage('en');
    expect(needsRestart).toBe(false);
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(DevSettings.reload).not.toHaveBeenCalled();
  });

  it('neither flips nor reloads between two RTL languages (ar → hs)', async () => {
    const { mod, I18nManager, DevSettings } = await bootModule({
      storedLanguage: 'ar',
      nativeRTL: true,
    });
    await mod.initI18n();
    const { needsRestart } = await mod.setLanguage('hs');
    expect(needsRestart).toBe(false);
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(DevSettings.reload).not.toHaveBeenCalled();
  });
});

describe('currentLanguage', () => {
  it('falls back to the default for a disabled 3-letter code (snk must not become "sn")', async () => {
    // snk (Soninké) is currently wired up but NOT in SUPPORTED_LANGUAGES
    // (only fr + ar are exposed). Selecting it must fall back to the default
    // language — and crucially must NOT be truncated to the 2-letter "sn"
    // (Shona). If snk is re-enabled, this should return 'snk' instead.
    const { mod } = await bootModule({ storedLanguage: 'fr' });
    await mod.initI18n();
    await mod.setLanguage('snk');
    const lang = mod.currentLanguage();
    expect(lang).not.toBe('sn');
    expect(lang).toBe('fr');
  });

  it('maps regional variants to their base language (fr-FR → fr)', async () => {
    const { mod } = await bootModule({ storedLanguage: 'fr' });
    await mod.initI18n();
    await mod.i18n.changeLanguage('fr-FR');
    expect(mod.currentLanguage()).toBe('fr');
  });

  it('falls back to the default language on unknown codes', async () => {
    const { mod } = await bootModule({ storedLanguage: 'fr' });
    await mod.initI18n();
    await mod.i18n.changeLanguage('de');
    expect(mod.currentLanguage()).toBe('fr');
  });
});
