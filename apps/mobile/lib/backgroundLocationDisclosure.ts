/**
 * Google Play "Prominent Disclosure & Consent" for background location.
 *
 * Play policy does not just require the ACCESS_BACKGROUND_LOCATION declaration
 * form and its demo video — it requires the APP ITSELF to explain the
 * background collection *before* the OS permission dialog appears, and to offer
 * a real way to decline. A runtime prompt alone, or an explanation buried in
 * the privacy policy, is a documented rejection cause.
 *
 * The copy must satisfy four things, all of which the `bgDisclosure*` strings
 * carry — change them only with this list in hand:
 *   1. name the data ("localisation")
 *   2. say it continues "même lorsque l'application est fermée ou inutilisée"
 *   3. state the actual use (dispatch of nearby rides + support follow-up)
 *   4. offer a decline that genuinely declines
 *
 * This is shown only when the permission is not already granted, and only on
 * the captain's own "go online" action — so it is never a cold nag.
 *
 * Deliberately NOT persisted: unlike the battery / full-screen-intent nudges,
 * a disclosure must precede EVERY permission request, so there is no
 * "already handled" flag to skip it.
 */
import { Alert } from 'react-native';
import { i18n } from './i18n';
import { APP_NAME } from './brand';

/**
 * Show the disclosure and resolve with the captain's answer.
 *
 * @returns `true` if they consented and the OS dialog may be shown,
 *          `false` on decline or dismissal (treated as a decline).
 */
export function showBackgroundLocationDisclosure(): Promise<boolean> {
  const t = i18n.t.bind(i18n);
  return new Promise((resolve) => {
    // Guard against a platform firing both a button and onDismiss: whoever
    // answers first wins, so the promise can never settle twice.
    let settled = false;
    const answer = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
    };

    Alert.alert(
      t('captain.state.bgDisclosureTitle', { app: APP_NAME }) as string,
      t('captain.state.bgDisclosureBody', { app: APP_NAME }) as string,
      [
        {
          text: t('captain.state.bgDisclosureDecline') as string,
          style: 'cancel',
          onPress: () => answer(false),
        },
        {
          text: t('captain.state.bgDisclosureAccept') as string,
          onPress: () => answer(true),
        },
      ],
      // Tapping outside is not consent. Android only; harmless elsewhere.
      { cancelable: true, onDismiss: () => answer(false) },
    );
  });
}
