/**
 * i18n bootstrap — i18next + react-i18next with AsyncStorage persistence.
 *
 * Supported languages: French (default), Arabic (RTL), English.
 *
 * RTL note: React Native bakes the layout direction at the JS bridge boot, so
 * toggling Arabic flips `I18nManager.forceRTL(true)` then *requires an app
 * restart* before mirrored layouts kick in. Settings screen warns the user.
 */

import 'intl-pluralrules';
import { I18nManager, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import fr from '@/locales/fr.json';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
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
export type AppLanguage = 'fr' | 'ar' | 'en' | 'ff' | 'wo' | 'snk';
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['fr', 'ar', 'en', 'ff', 'wo', 'snk'];
export const DEFAULT_LANGUAGE: AppLanguage = 'fr';

type Resource = Record<string, unknown>;
const LANGUAGE_RESOURCES: Record<AppLanguage, Resource> = {
  fr: fr as Resource,
  ar: ar as Resource,
  en: en as Resource,
  ff: ff as Resource,
  wo: wo as Resource,
  snk: snk as Resource,
};

const STORAGE_KEY = '@tewiz/language';
const RTL_LANGUAGES = new Set<AppLanguage>(['ar']);

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
 */
export async function setLanguage(lang: AppLanguage): Promise<{ needsRestart: boolean }> {
  await AsyncStorage.setItem(STORAGE_KEY, lang);
  const directionChanged = applyLayoutDirection(lang);
  await i18n.changeLanguage(lang);
  return { needsRestart: directionChanged };
}

export function currentLanguage(): AppLanguage {
  return (i18n.language?.slice(0, 2) as AppLanguage) ?? DEFAULT_LANGUAGE;
}

export { i18n };
