/**
 * i18n bootstrap — i18next + react-i18next with AsyncStorage persistence.
 *
 * Supported languages: French (default), Arabic (RTL), English.
 *
 * RTL note: the native layout direction is applied ONLY at boot, inside
 * initI18n() and before the first paint. Toggling to/from Arabic mid-session
 * therefore *requires an app restart* before mirrored layouts kick in — the
 * Settings screen warns the user. Never call forceRTL after the first render:
 * it mirrors only the views that re-render, so the UI jumps around.
 */

import 'intl-pluralrules';
import { I18nManager, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import fr from '@/locales/fr.json';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import hs from '@/locales/hs.json';
import ff from '@/locales/ff.json';
import wo from '@/locales/wo.json';
import snk from '@/locales/snk.json';

/**
 * Supported app languages. Order = order shown in the Settings picker.
 *  - fr  : French (source / fallback) — primary in Mauritania
 *  - ar  : Arabic (RTL) — official language
 *  - en  : English
 *  - ff  : Pulaar / Fulfulde — ISO 639-1 `ff` (also "Pular")
 *  - wo  : Wolof
 *  - snk : Soninké / Soninke — ISO 639-3 (no 639-1 code exists)
 *
 * Adding a new language: drop a `locales/<code>.json` file mirroring fr.json,
 * import it above and add the code to SUPPORTED_LANGUAGES + LANGUAGE_RESOURCES.
 */
export type AppLanguage = 'fr' | 'ar' | 'en' | 'hs' | 'ff' | 'wo' | 'snk';
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['fr', 'ar', 'en', 'hs', 'ff', 'wo', 'snk'];
export const DEFAULT_LANGUAGE: AppLanguage = 'fr';

type Resource = Record<string, unknown>;
const LANGUAGE_RESOURCES: Record<AppLanguage, Resource> = {
  fr: fr as Resource,
  ar: ar as Resource,
  en: en as Resource,
  hs: hs as Resource,
  ff: ff as Resource,
  wo: wo as Resource,
  snk: snk as Resource,
};

const STORAGE_KEY = '@tewiz/language';
const RTL_LANGUAGES = new Set<AppLanguage>(['ar', 'hs']);

function detectDeviceLanguage(): AppLanguage {
  try {
    let raw: string | undefined;
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      raw = settings?.AppleLocale ?? (settings?.AppleLanguages as string[] | undefined)?.[0];
    } else {
      raw = (NativeModules as { I18nManager?: { localeIdentifier?: string } }).I18nManager
        ?.localeIdentifier;
    }
    const lower = (raw ?? '').toLowerCase();
    // Soninké uses the ISO 639-3 three-letter code `snk`; check it before the
    // two-letter slice so we don't truncate it to `sn` (Shona).
    if (lower.startsWith('snk')) return 'snk';
    const code = lower.slice(0, 2);
    if (SUPPORTED_LANGUAGES.includes(code as AppLanguage)) return code as AppLanguage;
  } catch {}
  return DEFAULT_LANGUAGE;
}

async function readStoredLanguage(): Promise<AppLanguage | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw && SUPPORTED_LANGUAGES.includes(raw as AppLanguage)) return raw as AppLanguage;
  } catch {}
  return null;
}

export function isRTL(lang: AppLanguage): boolean {
  return RTL_LANGUAGES.has(lang);
}

/**
 * Force the RN layout direction to match the active language. Returns true
 * iff the direction actually changed — caller should warn the user that
 * mirrored layouts only take effect after a full app restart.
 *
 * ONLY call this before the first paint (i.e. from initI18n, which the root
 * layout awaits before rendering). Flipping `I18nManager.forceRTL` while
 * views are already mounted re-resolves the direction only for nodes that
 * happen to re-render, so the UI ends up half-mirrored — the home header and
 * the hero title visibly jump between LTR and RTL. See tests/i18n.test.ts.
 */
export function applyLayoutDirection(lang: AppLanguage): boolean {
  const wantRTL = isRTL(lang);
  if (I18nManager.isRTL === wantRTL) return false;
  try {
    I18nManager.allowRTL(wantRTL);
    I18nManager.forceRTL(wantRTL);
  } catch {}
  return true;
}

let initPromise: Promise<typeof i18n> | null = null;

export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await readStoredLanguage();
    const lang = stored ?? detectDeviceLanguage();
    applyLayoutDirection(lang);
    const resources = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((code) => [code, { translation: LANGUAGE_RESOURCES[code] }]),
    );
    await i18n.use(initReactI18next).init({
      resources,
      lng: lang,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false },
      returnNull: false,
      compatibilityJSON: 'v4',
    });
    return i18n;
  })();
  return initPromise;
}

/**
 * Persist and apply a new language. Returns true if the app must be restarted
 * to fully apply the layout direction change (i.e. switched to/from Arabic).
 *
 * The native layout direction is deliberately NOT flipped here: forceRTL on a
 * running app mirrors only the views that re-render next, leaving the rest in
 * the old direction (header/hero "jumping" bug). The stored language drives
 * applyLayoutDirection at the next boot, before anything is painted.
 */
export async function setLanguage(lang: AppLanguage): Promise<{ needsRestart: boolean }> {
  await AsyncStorage.setItem(STORAGE_KEY, lang);
  const needsRestart = isRTL(lang) !== I18nManager.isRTL;
  await i18n.changeLanguage(lang);
  return { needsRestart };
}

export function currentLanguage(): AppLanguage {
  const raw = i18n.language ?? '';
  // Exact match first so 3-letter codes (snk) survive; then map regional
  // variants (fr-FR → fr) to their base language.
  if (SUPPORTED_LANGUAGES.includes(raw as AppLanguage)) return raw as AppLanguage;
  const base = raw.slice(0, 2) as AppLanguage;
  return SUPPORTED_LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE;
}

export { i18n };
