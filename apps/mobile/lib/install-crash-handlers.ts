// Side-effect module: installs the global JS crash handlers at import time.
// Kept separate so it can be the very first import in app/_layout.tsx and
// run before anything else.
import { installCrashHandlers } from './crash-reporter';

installCrashHandlers();
