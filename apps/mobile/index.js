// Explicit app entry.
//
// `main` points here (a file that always exists inside apps/mobile) instead of
// directly at "expo-router/entry". In the pnpm-hoisted monorepo, EAS's isolated
// build could fail to resolve the hoisted "expo-router/entry" as the package
// `main`, silently falling back to Expo's default `expo/AppEntry.js` — which does
// `import App from '../../App'` and crashes the Android/iOS bundle (no App.tsx in
// an expo-router app). Re-exporting the router entry from a local file removes
// that ambiguity: Metro's resolver handles the (hoisted) import fine.
import 'expo-router/entry';
