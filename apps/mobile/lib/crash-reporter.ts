/**
 * Persists JS crashes so we can read them on the next launch.
 *
 * Why: without adb/logcat, when a release APK crashes on boot the user just
 * sees "Tewiz keeps stopping" with no detail. By writing the error to
 * AsyncStorage synchronously-ish and showing it on the next start, we get
 * a stacktrace surface.
 *
 * Captures:
 *  - Errors caught by React Error Boundary (render-time)
 *  - Unhandled JS errors via ErrorUtils.setGlobalHandler (async / event handlers)
 *  - Unhandled promise rejections
 *
 * Does NOT capture native crashes (Java/Kotlin/C++). For those, adb logcat
 * is still the only way.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@tewiz/last-crash';

export interface CrashEntry {
  when: string;
  label: string;
  message: string;
  stack?: string;
}

export async function saveCrash(label: string, err: unknown): Promise<void> {
  const entry: CrashEntry = {
    when: new Date().toISOString(),
    label,
    message:
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // If storage itself is broken, nothing we can do.
  }
}

export async function readAndClearCrash(): Promise<CrashEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    return JSON.parse(raw) as CrashEntry;
  } catch {
    return null;
  }
}

let installed = false;

/**
 * Installs handlers for unhandled JS errors and promise rejections.
 * Safe to call multiple times — only installs once.
 * Call as early as possible (e.g. at the top of the root layout module).
 */
export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;

  // 1. Generic JS errors (React Native's ErrorUtils).
  const ErrorUtils = (globalThis as any).ErrorUtils;
  if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === 'function') {
    const prev =
      typeof ErrorUtils.getGlobalHandler === 'function'
        ? ErrorUtils.getGlobalHandler()
        : null;
    ErrorUtils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
      void saveCrash(isFatal ? 'js-fatal' : 'js', err);
      if (prev) {
        try {
          prev(err, isFatal);
        } catch {}
      }
    });
  }

  // 2. Unhandled promise rejections.
  const g = globalThis as unknown as {
    process?: { on?: (ev: string, cb: (e: unknown) => void) => void };
    HermesInternal?: unknown;
  };
  if (g.process && typeof g.process.on === 'function') {
    g.process.on('unhandledRejection', (reason: unknown) => {
      void saveCrash('promise', reason);
    });
  }
}
