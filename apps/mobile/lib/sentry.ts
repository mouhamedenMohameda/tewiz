/**
 * Sentry integration — soft-init so the app keeps working without a DSN.
 *
 * Set EXPO_PUBLIC_SENTRY_DSN in eas.json (or .env for local dev) to turn
 * crash reporting on. Without it, all helpers become no-ops and we fall
 * back to the local AsyncStorage crash log (see crash-reporter.ts).
 *
 * Why a wrapper:
 *  - Lets us guard every call so a Sentry SDK bug never crashes the app.
 *  - Keeps the rest of the codebase free of Sentry imports.
 *  - Makes it trivial to swap the backend later (Bugsnag, etc.).
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let initialized = false;

/**
 * Initialise Sentry once, as early as possible. Safe to call multiple times.
 * No-op if the DSN env var is missing — local crash log still works.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      // Release = app version from app.config.ts. Lets us filter crashes
      // by version on the Sentry dashboard.
      release: Constants.expoConfig?.version,
      // Distinguish builds (preview vs production) without per-build code.
      environment:
        (process.env.EXPO_PUBLIC_ENV as string | undefined) ?? 'production',
      // Performance sampling stays low to keep the free-tier quota happy.
      // Bump if/when we move to a paid plan.
      tracesSampleRate: 0.05,
      // Don't auto-capture console.log spam — only console.error.
      enableAutoSessionTracking: true,
      // Native crashes (Android/iOS) are captured by default; this just
      // makes the JS-side capture loud about it during development.
      attachStacktrace: true,
    });
    initialized = true;
  } catch {
    // Sentry SDK itself crashed — keep the app alive, AsyncStorage log
    // is still in place.
  }
}

/** Report a caught exception. No-op if Sentry isn't initialised. */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    if (context) {
      Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Swallow — never let crash reporting itself crash the app.
  }
}

/**
 * Tag the current Sentry scope with the signed-in user so crashes are
 * grouped per user on the dashboard. Call after login; call with null
 * on logout/account-deletion.
 */
export function setUser(user: { id: string; phone: string } | null): void {
  if (!initialized) return;
  try {
    Sentry.setUser(user ? { id: user.id, username: user.phone } : null);
  } catch {
    // ignore
  }
}
