/**
 * RTL helpers — the few places where the layout engine does NOT mirror by
 * itself and a manual, centralized correction is required.
 *
 * Everything else (plain rows, logical start/end spacing, alignItems) is
 * mirrored automatically by Yoga when I18nManager.isRTL is set — screens must
 * NEVER hand-flip those with `row-reverse`.
 */

import { I18nManager } from 'react-native';

/**
 * Direction for WRAPPING rows only. Yoga mirrors plain rows under RTL but
 * does not reverse the fill order of `flexWrap` lines — wrapped grids (the
 * home shortcut tiles, chip lists…) keep filling left→right in an otherwise
 * mirrored UI. Flip them manually.
 *
 * A module-level constant is safe: the direction is fixed for the whole JS
 * session (a language switch that changes direction reloads the bundle).
 */
export const wrapRow: 'row' | 'row-reverse' = I18nManager.isRTL ? 'row-reverse' : 'row';
