/**
 * ThemeProvider — points the design tokens at the OS colour scheme.
 *
 * How the light/dark swap actually propagates, because it is not obvious:
 *
 *  - `colors` and friends are getters onto whichever palette is active, so a
 *    component reading `colors.canvas` during render always gets the current
 *    value. No component needs a hook or a context to be themed.
 *  - What components DO need is to re-render when the scheme changes. That is
 *    this provider's whole job: `useColorScheme()` re-renders it on change, and
 *    since the app memoises nothing, that re-render reaches every screen below.
 *    (Verified: zero `React.memo` in app/ and components/. If one is ever added
 *    around a coloured subtree, it must subscribe to `useScheme()` or it will
 *    keep painting the old palette.)
 *  - The scheme is set DURING render, not in an effect. An effect would run
 *    after the first paint, so a cold start in dark mode would flash the light
 *    palette for a frame. The assignment is idempotent, so doing it in render
 *    is safe.
 *  - The Captain's own preference (système / clair / sombre) overrides the OS.
 *    It is read synchronously from lib/themePreference, which app/_layout.tsx
 *    loads BEFORE the first paint — for the same anti-flash reason as above.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useThemePreference } from '@/lib/themePreference';
import { currentScheme, setScheme, type SchemeName } from './index';

const SchemeContext = createContext<SchemeName>('light');

/** The active scheme, for the rare component that needs to branch on it. */
export function useScheme(): SchemeName {
  return useContext(SchemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Le réglage du Captain prime sur l'OS. `useColorScheme()` est appelé dans
  // tous les cas — c'est un hook, il ne peut pas être conditionnel — mais son
  // résultat n'est retenu que sur 'system'.
  const osScheme: SchemeName = useColorScheme() === 'dark' ? 'dark' : 'light';
  const preference = useThemePreference();
  const scheme: SchemeName = preference === 'system' ? osScheme : preference;

  // Before the subtree renders, so the very first frame is already correct.
  if (currentScheme() !== scheme) setScheme(scheme);

  return (
    <SchemeContext.Provider value={scheme}>
      {children}
    </SchemeContext.Provider>
  );
}
