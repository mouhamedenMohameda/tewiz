/**
 * i18n bootstrap — i18next + react-i18next with AsyncStorage persistence.
 *
 * Supported languages: French (default), Arabic (RTL), English.
 *
 * RTL note: the native layout direction (I18nManager) is the SINGLE source of
 * truth for mirroring — screens must never hand-flip rows with `row-reverse`,
 * Yoga already mirrors `row` when the direction is RTL. The direction is
 * applied at boot (initI18n, before the first paint); when the user switches
 * to/from Arabic mid-session, setLanguage() flips it and immediately reloads
 * the JS bundle (lib/restart.ts) so the whole tree rebuilds in one consistent
 * direction. Never call forceRTL without reloading: it mirrors only the views
 * created afterwards, so the UI ends up half-mirrored ("dancing" layouts).
 */

import 'intl-pluralrules';
import { I18nManager, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { reloadApp } from './restart';

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
// Only fr + ar are exposed in the UI; other locales stay wired up (imports,
// LANGUAGE_RESOURCES, RTL set) so they can be re-enabled by adding them back.
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['fr', 'ar'];
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
 * iff the direction actually changed.
 *
 * Only call this before the first paint (initI18n) or immediately before a
 * full JS reload (setLanguage). Flipping `I18nManager.forceRTL` while views
 * stay mounted re-resolves the direction only for nodes that happen to
 * re-render, so the UI ends up half-mirrored — the home header and the hero
 * title visibly jump between LTR and RTL. See tests/i18n.test.ts.
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
    // Android swaps `left`/`right` styles in RTL by default; iOS never does.
    // Disable the swap so physical left/right mean the same thing on both
    // platforms — mirrored spacing must use the logical start/end props.
    try {
      I18nManager.swapLeftAndRightInRTL(false);
    } catch {}
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
 * Persist and apply a new language.
 *
 * When the layout direction changes (switched to/from Arabic) the native
 * direction is flipped and the JS bundle reloads immediately: forceRTL on a
 * running app mirrors only the views created afterwards, so the only clean
 * way to apply the flip is to rebuild the whole tree — the next boot re-reads
 * the stored language and paints everything in the right direction from the
 * first frame.
 *
 * Returns { needsRestart: true } ONLY when the automatic reload was not
 * available — the caller should then ask the user to restart manually.
 */
export async function setLanguage(lang: AppLanguage): Promise<{ needsRestart: boolean }> {
  await AsyncStorage.setItem(STORAGE_KEY, lang);
  const directionChanged = isRTL(lang) !== I18nManager.isRTL;
  await i18n.changeLanguage(lang);
  if (!directionChanged) return { needsRestart: false };
  applyLayoutDirection(lang);
  const reloaded = await reloadApp();
  return { needsRestart: !reloaded };
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
