/**
 * Préférence de thème du Captain : système / clair / sombre.
 *
 * Jusqu'ici l'app suivait l'apparence du téléphone, sans recours. Un Captain
 * qui garde son iPhone en sombre pour le reste de ses apps se retrouvait avec
 * une interface sombre en plein soleil de Nouakchott — au volant, c'est le
 * mauvais réglage, et il n'avait aucun moyen d'en sortir.
 *
 * Chargée AVANT le premier rendu (voir le `ready` de app/_layout.tsx) : le
 * ThemeProvider fixe le scheme pendant le rendu justement pour qu'aucune image
 * ne s'affiche dans la mauvaise palette, et lire ce réglage dans un effet
 * aurait rendu ce soin inutile en faisant clignoter l'écran au démarrage.
 *
 * Même forme que lib/modulePreferences : état de module + abonnés, pas de
 * contexte React. Le ThemeProvider est au-dessus de tout, il ne peut pas
 * dépendre d'un provider qui serait encore plus haut.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

const STORAGE_KEY = '@tewiz/theme-preference';

let current: ThemePreference = 'system';
let loaded = false;
const listeners = new Set<(p: ThemePreference) => void>();

function isPreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** Lecture synchrone, pour le rendu. */
export function currentThemePreference(): ThemePreference {
  return current;
}

/** Appelée une fois au démarrage, avant le premier rendu. */
export async function initThemePreference(): Promise<ThemePreference> {
  if (loaded) return current;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    // Une valeur inconnue (build plus ancien, stockage corrompu) retombe sur
    // 'system' plutôt que de figer l'app sur une palette introuvable.
    if (isPreference(raw)) current = raw;
  } catch {
    // Stockage illisible : 'system' reste un défaut correct, ce n'est pas une
    // raison d'empêcher l'app de démarrer.
  }
  loaded = true;
  return current;
}

export async function setThemePreference(next: ThemePreference): Promise<void> {
  if (next === current) return;
  current = next;
  // Notifier d'abord : le changement de palette doit être immédiat à l'écran,
  // l'écriture disque n'a pas à le retenir.
  listeners.forEach((fn) => fn(next));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Le réglage reste actif pour cette session même si l'écriture échoue.
  }
}

/** S'abonne aux changements. Rend le composant à chaque bascule. */
export function useThemePreference(): ThemePreference {
  const [pref, setPref] = useState<ThemePreference>(current);
  useEffect(() => {
    // Le module a pu changer entre le premier rendu et l'abonnement.
    setPref(current);
    listeners.add(setPref);
    return () => { listeners.delete(setPref); };
  }, []);
  return pref;
}

/** Remise à zéro — tests uniquement. */
export function __resetThemePreference(): void {
  current = 'system';
  loaded = false;
  listeners.clear();
}
