/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  APP BRAND — single source of truth                                │
 * │                                                                    │
 * │  👉 To rebrand the app, edit the "name" field in  ../brand.json    │
 * │     (one line). The new name then propagates EVERYWHERE: the       │
 * │     auth/splash screen, alerts, headers, AND the native app name   │
 * │     (app.config.ts reads the same brand.json).                     │
 * │                                                                    │
 * │  This file just re-exports brand.json as typed constants so the    │
 * │  app can do:  import { APP_NAME } from '@/lib/brand'               │
 * └──────────────────────────────────────────────────────────────────┘
 */

import brand from '../brand.json';

/** Public-facing display name. The one value to change in brand.json. */
export const APP_NAME = brand.name;

/**
 * ⚠️ Technical identifiers — keep STABLE across rebrands.
 * Changing these breaks deep links and creates a brand-new app in the
 * App Store / Play Store (you lose installs, reviews and ratings).
 */
export const APP_SLUG = brand.slug; // EAS / Expo project slug
export const APP_SCHEME = brand.scheme; // deep-link scheme (tewiz://...)
export const BUNDLE_ID = brand.bundleId; // iOS bundle id & Android package
