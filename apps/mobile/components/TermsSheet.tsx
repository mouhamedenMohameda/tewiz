/**
 * TermsSheet — full-screen, scrollable rendering of the captain terms &
 * conditions with an explicit "I accept" button.
 *
 * The button only unlocks once the captain has scrolled to the end of the
 * text: consent to a wall of legalese nobody could have read is worth nothing,
 * and the scroll position is the cheapest honest proof that it was displayed.
 *
 * Two modes:
 *  - `dismissible` (default): a Close button lets the captain back out; used
 *    from the checkbox on the become-captain screen.
 *  - `dismissible={false}`: no way out but accepting (or the optional
 *    secondary action, e.g. log out); used by the gate for existing captains.
 */

import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { PlainText as Text } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';
import { colors, radius, statusTone } from '@/theme';

// Languages offered inside the sheet. The captain can read the terms in either
// one regardless of the app's global language — switching here does NOT change
// the app language (that would reload the whole bundle).
const TERMS_LANGS = [
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
] as const;
type TermsLang = (typeof TERMS_LANGS)[number]['code'];

interface TermsSection {
  title: string;
  body: string;
}

export interface TermsSheetProps {
  visible: boolean;
  /** Spinner on the accept button while the consent is being recorded. */
  busy?: boolean;
  /** Shows a Close button and honours the Android back button. */
  dismissible?: boolean;
  onAccept: () => void;
  onClose?: () => void;
  /** Optional escape hatch rendered next to Accept (used for "log out"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Highlighted banner above the text, e.g. "the terms were updated". */
  notice?: string;
}

export function TermsSheet({
  visible, busy = false, dismissible = true,
  onAccept, onClose, secondaryLabel, onSecondary, notice,
}: TermsSheetProps) {
  // Called for its re-render-on-language-change side effect; the visible strings
  // are read through `tt` (the fixed translator) below, not this `t`.
  useTranslation();
  // A RN <Modal> renders in its own host view outside the SafeAreaProvider, so
  // <SafeAreaView> inside it measures 0 insets and the header slides under the
  // status bar. Read the insets from context here (this component IS under the
  // provider) and pad manually.
  const insets = useSafeAreaInsets();
  const [readToEnd, setReadToEnd] = useState(false);
  // Content shorter than the viewport can never fire an end-of-scroll event,
  // so unlock as soon as we know it all fits on screen.
  const viewportH = useRef(0);
  const contentH = useRef(0);

  // Language the terms are DISPLAYED in — defaults to the app language, but the
  // captain can flip it in the header. `tt` is a fixed translator bound to that
  // language, so we read the strings for `lang` no matter the app language.
  const [lang, setLang] = useState<TermsLang>(
    () => ((i18n.language || 'fr').split('-')[0] === 'ar' ? 'ar' : 'fr'),
  );
  const tt = useMemo(() => i18n.getFixedT(lang), [lang]);
  const rtl = lang === 'ar';
  const dirStyle = {
    textAlign: rtl ? ('right' as const) : ('left' as const),
    writingDirection: rtl ? ('rtl' as const) : ('ltr' as const),
  };

  function switchLang(next: TermsLang) {
    if (next === lang) return;
    setLang(next);
    // The other language is a different wall of text — re-lock the button so
    // the captain scrolls what they're about to accept.
    setReadToEnd(false);
  }

  const sections = useMemo(() => {
    const raw = tt('terms.sections', { returnObjects: true }) as unknown;
    return Array.isArray(raw) ? (raw as TermsSection[]) : [];
  }, [tt]);

  function unlockIfShort() {
    if (viewportH.current && contentH.current && contentH.current <= viewportH.current + 8) {
      setReadToEnd(true);
    }
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    // 40px of slack — reaching the exact pixel is fiddly with bounce/overscroll.
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 40) {
      setReadToEnd(true);
    }
  }

  const canAccept = readToEnd && !busy;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={dismissible ? onClose : () => {}}
    >
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View style={{
          paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: colors.line,
        }}>
          {/* Language switch — reads the terms in AR or FR without changing the
              app language. */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {TERMS_LANGS.map((l) => {
              const active = l.code === lang;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => switchLang(l.code)}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.ember : colors.lineStrong,
                    backgroundColor: active ? colors.ember : '#fff',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : colors.ink2 }}>
                    {l.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[{ fontSize: 21, fontWeight: '700', color: colors.ink }, dirStyle]}>
            {tt('terms.title', { app: APP_NAME })}
          </Text>
          <Text style={[{ fontSize: 12, color: colors.ink2, marginTop: 4 }, dirStyle]}>
            {tt('terms.subtitle')}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 28 }}
          onScroll={onScroll}
          scrollEventThrottle={64}
          onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; unlockIfShort(); }}
          onContentSizeChange={(_w, h) => { contentH.current = h; unlockIfShort(); }}
        >
          {notice ? (
            <View style={{
              backgroundColor: statusTone.pending.bg, borderWidth: 1, borderColor: statusTone.pending.bg,
              borderRadius: radius.md, padding: 14, marginBottom: 18,
            }}>
              <Text style={{ fontSize: 13, color: statusTone.pending.fg, lineHeight: 21 }}>{notice}</Text>
            </View>
          ) : null}

          <Text style={[{ fontSize: 13, color: colors.ink2, lineHeight: 22 }, dirStyle]}>
            {tt('terms.intro', { app: APP_NAME })}
          </Text>

          {sections.map((s, i) => (
            <View key={i} style={{ marginTop: 22 }}>
              <Text style={[{ fontSize: 15, fontWeight: '700', color: colors.ink }, dirStyle]}>
                {interpolateApp(s.title)}
              </Text>
              <Text style={[{ fontSize: 13, color: colors.ink2, lineHeight: 23, marginTop: 6 }, dirStyle]}>
                {interpolateApp(s.body)}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={{
          paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 + insets.bottom,
          borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface,
        }}>
          {!readToEnd ? (
            <Text style={{ fontSize: 12, color: colors.faint, marginBottom: 10, textAlign: 'center' }}>
              {tt('terms.scrollHint')}
            </Text>
          ) : null}

          <Pressable
            disabled={!canAccept}
            onPress={onAccept}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.emberDeep : colors.ember,
              opacity: canAccept ? 1 : 0.4,
              paddingVertical: 16, borderRadius: radius.lg,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            })}
          >
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: colors.white, fontSize: 15, fontWeight: '700' }}>
              {tt('terms.accept')}
            </Text>
          </Pressable>

          {dismissible && onClose ? (
            <Pressable
              onPress={onClose}
              style={{ paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: colors.ink2, fontSize: 15, fontWeight: '600' }}>
                {tt('terms.close')}
              </Text>
            </Pressable>
          ) : null}

          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              style={{ paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: colors.danger, fontSize: 15, fontWeight: '600' }}>
                {secondaryLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// Whether i18next interpolates inside a `returnObjects` payload depends on its
// options, so substitute the brand placeholder here as well — a no-op when it
// already did.
function interpolateApp(s: string): string {
  return String(s ?? '').replace(/\{\{app\}\}/g, APP_NAME);
}
