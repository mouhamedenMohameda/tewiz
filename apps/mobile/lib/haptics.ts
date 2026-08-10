/**
 * Haptics — the third channel of feedback, alongside motion and colour.
 *
 * Three rules govern every call site:
 *
 *  1. Causality — fire it on the actual causal event (the sheet snapping home,
 *     the ride being confirmed), never "somewhere around then". If the user
 *     can't tell what caused the tap, it's noise.
 *  2. Harmony — fire it on the same frame as the visual. A haptic that lands
 *     after the animation reads as a glitch, not as feedback.
 *  3. Utility — reserve it for moments that matter: a commit, a snap, a
 *     success, an error. Feedback on everything trains people to feel nothing.
 *
 * IMPLEMENTATION NOTE — this is deliberately dependency-free.
 * `expo-haptics` is a native module, and this app is built to run in Expo Go
 * and in the existing dev client without an EAS rebuild, so we use React
 * Native's built-in Vibration API instead. That limits us to Android: iOS's
 * Vibration API ignores the duration and fires one heavy ~400ms buzz, which is
 * far worse than silence for a selection tick, so iOS is a deliberate no-op.
 *
 * To switch iOS on (and get real Taptic patterns on both platforms), add
 * `expo-haptics`, rebuild, and replace the bodies below — every call site in
 * the app already goes through this module, so nothing else changes:
 *
 *   import * as Haptics from 'expo-haptics';
 *   selection: () => Haptics.selectionAsync()
 *   impact:    () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
 *   success:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
 */

import { Platform, Vibration } from 'react-native';

/** iOS has no short-vibration primitive without a native module — see above. */
const SUPPORTED = Platform.OS === 'android';

let enabled = true;

/** Global off switch (e.g. a future "vibration" preference in Settings). */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function buzz(pattern: number | number[]): void {
  if (!SUPPORTED || !enabled) return;
  try {
    Vibration.vibrate(pattern as number);
  } catch {
    // A device with no vibrator, or a permission edge case. Feedback is a
    // bonus channel — never let it take a gesture down with it.
  }
}

export const haptics = {
  /** A value changed under the finger: a snap point, a segment, a picker row. */
  selection: () => buzz(8),
  /** Something landed or was grabbed — a sheet reaching its stop. */
  impact: () => buzz(12),
  /** An action committed successfully: ride confirmed, form accepted. */
  success: () => buzz([0, 14, 60, 22]),
  /** A refusal: invalid input, an unavailable action. */
  warning: () => buzz([0, 22, 70, 22]),
  /** A failure the user has to deal with. */
  error: () => buzz([0, 28, 80, 28, 80, 28]),
} as const;
