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
import { PlainText as Text } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

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
  const { t } = useTranslation();
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

  const sections = useMemo(() => {
    const raw = t('terms.sections', { returnObjects: true }) as unknown;
    return Array.isArray(raw) ? (raw as TermsSection[]) : [];
  }, [t]);

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
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
        <View style={{
          paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
        }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
            {t('terms.title', { app: APP_NAME })}
          </Text>
          <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {t('terms.subtitle')}
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
              backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
              borderRadius: 12, padding: 14, marginBottom: 18,
            }}>
              <Text style={{ fontSize: 14, color: '#78350f', lineHeight: 21 }}>{notice}</Text>
            </View>
          ) : null}

          <Text style={{ fontSize: 14, color: '#334155', lineHeight: 22 }}>
            {t('terms.intro', { app: APP_NAME })}
          </Text>

          {sections.map((s, i) => (
            <View key={i} style={{ marginTop: 22 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a' }}>
                {interpolateApp(s.title)}
              </Text>
              <Text style={{ fontSize: 14, color: '#334155', lineHeight: 23, marginTop: 6 }}>
                {interpolateApp(s.body)}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={{
          paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 + insets.bottom,
          borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff',
        }}>
          {!readToEnd ? (
            <Text style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, textAlign: 'center' }}>
              {t('terms.scrollHint')}
            </Text>
          ) : null}

          <Pressable
            disabled={!canAccept}
            onPress={onAccept}
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
              opacity: canAccept ? 1 : 0.4,
              paddingVertical: 16, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            })}
          >
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {t('terms.accept')}
            </Text>
          </Pressable>

          {dismissible && onClose ? (
            <Pressable
              onPress={onClose}
              style={{ paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: '#475569', fontSize: 15, fontWeight: '600' }}>
                {t('terms.close')}
              </Text>
            </Pressable>
          ) : null}

          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              style={{ paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: '#b91c1c', fontSize: 15, fontWeight: '600' }}>
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
