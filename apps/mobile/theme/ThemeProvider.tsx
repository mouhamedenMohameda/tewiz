/**
 * ThemeProvider — points the design tokens at the OS colour scheme.
 *
 * How the light/dark swap actually propagates, because it is not obvious:
 *
 *  - `colors` and friends are getters onto whichever palette is active, so a
 *    component reading `colors.canvas` during render always gets the current
 *    value. No component needs a hook or a context to be themed.
 *  - What components DO need is to re-render when the scheme changes, and this
 *    provider re-rendering is NOT enough to give them that. React Navigation
 *    wraps every screen in a `React.memo` (`StaticContainer`, whose props are
 *    only name/render/navigation/route), so a re-render at the root stops dead
 *    at each mounted screen. That is what made the theme look half-applied:
 *    the screen the Captain was touching repainted — it had its own state —
 *    while every screen behind it in the stack kept the old palette until it
 *    happened to re-render for some unrelated reason.
 *  - A React context is the one thing that crosses a memo boundary: React marks
 *    consumers dirty and re-renders them through any bailout in between. Hence
 *    `useThemeRepaint()`, which every route component calls as its first line.
 *    It is the whole propagation mechanism, not a nicety — a screen that omits
 *    it keeps painting the palette it was mounted with. tests/themeRepaint
 *    fails the build when a route file is missing it.
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

/**
 * Repaint this screen when the scheme changes.
 *
 * Called as the first line of every route component in app/. It looks like it
 * does nothing, and that is the point: subscribing to the context is the
 * effect. React Navigation memoises each mounted screen, so nothing below that
 * boundary re-renders when the palette swaps — except a context consumer, which
 * React re-renders through the memo. Screens read colours through the module
 * getters in @/theme rather than from this hook, so there is no value to
 * return; the subscription alone is what makes those getters read fresh.
 */
export function useThemeRepaint(): void {
  useScheme();
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
