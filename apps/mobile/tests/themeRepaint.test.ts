/**
 * Le thème doit changer PARTOUT, pas seulement sur l'écran touché.
 *
 * React Navigation enveloppe chaque écran monté dans un `React.memo`
 * (`StaticContainer`). Un nouveau rendu de <ThemeProvider> s'arrête donc net à
 * chaque écran : le Captain choisissait « Clair » dans Réglages, cet écran-là
 * se repeignait — il avait son propre state — et tous ceux empilés derrière
 * gardaient la palette sombre jusqu'à un rendu déclenché par autre chose.
 *
 * Un contexte React est la seule chose qui traverse un memo. `useThemeRepaint()`
 * est cet abonnement, et il n'agit que sur l'écran qui l'appelle : une route qui
 * l'oublie reste peinte dans la palette de son montage. D'où ce test — le seul
 * garde-fou possible pour un écran ajouté dans six mois.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = join(__dirname, '..', 'app');

// app/_layout.tsx MONTE le provider : il est au-dessus du contexte, il ne peut
// pas s'y abonner — et il n'en a pas besoin, il se rend déjà à chaque bascule.
const PROVIDER_ROOT = 'app/_layout.tsx';

function routeFiles(dir: string, prefix = 'app'): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}/${entry}`);
    return entry.endsWith('.tsx') ? [`${prefix}/${entry}`] : [];
  });
}

const routes = routeFiles(APP_DIR).filter((f) => f !== PROVIDER_ROOT).sort();

describe('useThemeRepaint dans chaque route', () => {
  it('trouve bien les routes (le test ne passe pas à vide)', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it.each(routes)('%s se repeint au changement de thème', (route) => {
    const src = readFileSync(join(APP_DIR, '..', route), 'utf8');

    expect(src).toContain("import { useThemeRepaint } from '@/theme/ThemeProvider';");

    // Première ligne du composant : avant tout `return` anticipé, sinon
    // l'abonnement saute précisément dans les rendus où l'écran ne fait rien
    // d'autre — et un hook conditionnel casserait l'ordre des hooks.
    const component = /export default function \w+\([^)]*\) \{\n(.*)\n/.exec(src);
    expect(component?.[1].trim()).toBe('useThemeRepaint();');
  });
});
