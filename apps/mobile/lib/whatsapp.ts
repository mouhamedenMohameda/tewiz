/**
 * Thin helpers around opening WhatsApp from the app.
 *
 * We use the universal https://wa.me / chat.whatsapp.com links rather than the
 * `whatsapp://` scheme: the https form opens the WhatsApp app directly when it
 * is installed and otherwise falls back to the browser (which then offers to
 * open or install WhatsApp), so there is nothing to detect up front. Callers
 * pass an already-translated `errorMessage` so this module stays free of any
 * i18n dependency.
 */

import { Alert, Linking } from 'react-native';

/** Keep digits only — wa.me wants a bare international number, no '+' or spaces. */
function sanitizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

interface ChatOpts {
  /** Prefilled message body (e.g. a voice-order instruction). */
  text?: string;
  /** Translated message shown if the link can't be opened at all. */
  errorMessage?: string;
}

/** Open a 1:1 WhatsApp chat with `phone`, optionally prefilling a message. */
export async function openWhatsAppChat(phone: string, opts: ChatOpts = {}): Promise<void> {
  const digits = sanitizePhone(phone);
  if (!digits) return;
  const query = opts.text ? `?text=${encodeURIComponent(opts.text)}` : '';
  try {
    await Linking.openURL(`https://wa.me/${digits}${query}`);
  } catch {
    if (opts.errorMessage) Alert.alert('WhatsApp', opts.errorMessage);
  }
}

/** Open a WhatsApp group/invite link (chat.whatsapp.com/…) or any WhatsApp URL. */
export async function openWhatsAppLink(url: string, errorMessage?: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  try {
    await Linking.openURL(trimmed);
  } catch {
    if (errorMessage) Alert.alert('WhatsApp', errorMessage);
  }
}
