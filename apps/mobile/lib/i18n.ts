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
import { AppState, I18nManager, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { reloadApp } from './restart';
import { API_URL } from './env';

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

// --- Admin-editable translation overrides -----------------------------------
// Corrections made from the admin (apps/admin-web /settings/translations) are
// layered on top of the JSON bundled in this binary — the bundle stays the
// offline/first-launch fallback, never replaced outright. Each override fetch
// returns the FULL current override map for a language (not a diff), so a
// re-merge always starts clean from the bundled base; nothing can accumulate
// stale keys. See apps/api/src/modules/public/public.routes.ts (GET /public/i18n/:lang).
const OVERRIDES_KEY_PREFIX = '@tewiz/i18n-overrides:';
const FOREGROUND_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h

interface CachedOverrides {
  version: string;
  data: Record<string, string>;
}

async function readCachedOverrides(lang: AppLanguage): Promise<CachedOverrides | null> {
  try {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY_PREFIX + lang);
    return raw ? (JSON.parse(raw) as CachedOverrides) : null;
  } catch {
    return null;
  }
}

async function writeCachedOverrides(
  lang: AppLanguage,
  version: string,
  data: Record<string, string>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(OVERRIDES_KEY_PREFIX + lang, JSON.stringify({ version, data }));
  } catch {}
}

// Applies dot-notation overrides (e.g. "rider.home.title") onto a deep clone
// of a nested resource object. Keys are always pre-existing (the admin only
// edits values, never adds/removes keys — see translations.routes.ts), so this
// never needs to invent structure beyond what a dotted path implies.
function applyOverrides(base: Resource, overrides: Record<string, string>): Resource {
  if (Object.keys(overrides).length === 0) return base;
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const parts = key.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

async function fetchOverrides(
  lang: AppLanguage,
  since: string | null,
): Promise<{ version: string; overrides: Record<string, string> | null } | null> {
  try {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const res = await fetch(`${API_URL}/public/i18n/${lang}${qs}`);
    if (!res.ok) return null;
    return (await res.json()) as { version: string; overrides: Record<string, string> | null };
  } catch {
    return null;
  }
}

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
    // Layer any previously-fetched admin corrections on top of the bundled
    // JSON before i18next ever sees it, so a fix shows up from the first
    // frame — not just after this session's background sync completes.
    const cached = await Promise.all(SUPPORTED_LANGUAGES.map(readCachedOverrides));
    const resources = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((code, i) => {
        const overrides = cached[i];
        const translation = overrides
          ? applyOverrides(LANGUAGE_RESOURCES[code], overrides.data)
          : LANGUAGE_RESOURCES[code];
        return [code, { translation }];
      }),
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

/**
 * Fetch the latest admin-edited overrides for every supported language,
 * merge any that changed into the running i18next instance (existing screens
 * re-render via react-i18next's subscription to addResourceBundle), and cache
 * them for the next cold start. Safe to call anytime — network failures are
 * swallowed, since the bundled JSON is always a complete fallback on its own.
 */
export async function syncTranslationOverrides(): Promise<void> {
  for (const lang of SUPPORTED_LANGUAGES) {
    try {
      const cached = await readCachedOverrides(lang);
      const result = await fetchOverrides(lang, cached?.version ?? null);
      if (!result?.overrides) continue; // fetch failed or nothing changed
      await writeCachedOverrides(lang, result.version, result.overrides);
      if (i18n.hasResourceBundle(lang, 'translation')) {
        const merged = applyOverrides(LANGUAGE_RESOURCES[lang], result.overrides);
        i18n.addResourceBundle(lang, 'translation', merged, true, true);
      }
    } catch {}
  }
}

let lastForegroundSyncAt = 0;

/**
 * Call once after initI18n() settles. Runs an immediate sync (covers the
 * cold-start case) and re-syncs whenever the app returns to the foreground,
 * throttled to once an hour so a fix published from the admin shows up within
 * a session without polling on every tab switch. Returns an unsubscribe.
 */
export function startTranslationSync(): () => void {
  lastForegroundSyncAt = Date.now();
  void syncTranslationOverrides();
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    const now = Date.now();
    if (now - lastForegroundSyncAt < FOREGROUND_SYNC_MIN_INTERVAL_MS) return;
    lastForegroundSyncAt = now;
    void syncTranslationOverrides();
  });
  return () => sub.remove();
}

export { i18n };
