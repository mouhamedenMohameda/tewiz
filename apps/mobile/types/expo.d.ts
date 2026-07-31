/// <reference types="expo/types" />

// Committed on purpose, unlike expo-env.d.ts.
//
// Expo generates `expo-env.d.ts` with this exact reference, and its own header
// tells you to gitignore it — apps/mobile/.gitignore:36 does. That works on a
// machine where `expo start` has run at least once, and fails everywhere else:
// a fresh checkout has no expo-env.d.ts and no .expo/types, so `require.context`
// in App.tsx is undeclared and `tsc` stops with
//   App.tsx(3,21): error TS2339: Property 'context' does not exist on type 'Require'.
//
// That is precisely the CI runner, which is why the very first CI runs failed
// while `pnpm -r typecheck` passed locally for everyone.
//
// The reference is idempotent: when expo-env.d.ts also exists, declaring the
// same types twice costs nothing. Picked up by the `**/*.ts` include already in
// tsconfig.json, so nothing else needs to change.
