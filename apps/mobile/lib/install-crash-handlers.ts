// Side-effect module: installs the global JS crash handlers at import time.
// Kept separate so it can be the very first import in app/_layout.tsx and
// run before anything else.
//
// Order matters: Sentry first so it can capture any error that fires
// during the crash-handler install itself. Both are safe no-ops when
// their respective config is missing (no DSN → Sentry off; AsyncStorage
// log always runs).
import { initSentry } from './sentry';
import { installCrashHandlers } from './crash-reporter';

initSentry();
installCrashHandlers();
