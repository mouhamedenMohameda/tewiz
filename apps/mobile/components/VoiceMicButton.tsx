/**
 * Floating push-to-talk microphone button.
 *
 * Tap → start recording. Tap again → stop and emit the audio URI to the
 * parent via `onCaptured`. While recording, the button shows a pulsing
 * red dot and the elapsed seconds.
 *
 * The parent owns the upload + result handling. This component is just
 * the trigger.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlainText as Text, PressableScale } from '@/components/ui';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { haptics } from '@/lib/haptics';
import { colors, radius, schemed, statusTone } from '@/theme';

interface Props {
  onCaptured: (audioUri: string) => void;
  /** Show an external loading indicator while the parent uploads. */
  busy?: boolean;
  /** Optional label shown next to the icon (overrides the i18n default). */
  label?: string;
  /** Optional position override; defaults to bottom-right of the screen. */
  bottom?: number;
  right?: number;
}

export function VoiceMicButton({
  onCaptured,
  busy = false,
  label,
  bottom = 96,
  right = 16,
}: Props) {
  const { t } = useTranslation();
  const restLabel = label ?? t('voiceMicButton.speak');
  const { isRecording, durationMs, error, start, stop } = useVoiceRecorder();

  // Pulse animation for the red dot while recording.
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    // A looping oscillation is exactly the kind of continuous movement Reduce
    // Motion exists to stop. The dot stays — it's the state indicator — it just
    // stops breathing; the elapsed-seconds counter already says "recording".
    if (!isRecording || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: 600,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0, duration: 600,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulse, reduceMotion]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.4] });

  async function onPress() {
    if (busy) return;
    // Starting and stopping a recording are the two moments here worth a
    // haptic: the microphone opening and closing is a state change the user
    // needs to trust without looking, and it's caused by this exact tap.
    if (isRecording) {
      const uri = await stop();
      if (uri) {
        haptics.success();
        onCaptured(uri);
      } else {
        haptics.warning();
      }
    } else {
      haptics.impact();
      await start();
    }
  }

  const seconds = Math.floor(durationMs / 1000);
  const ss = seconds < 10 ? `0${seconds}` : `${seconds}`;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom, right }]}>
      {error ? (
        <View style={styles.errorBubble}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <PressableScale
        onPress={onPress}
        disabled={busy}
        style={[
          styles.button,
          isRecording ? styles.buttonRec : null,
          busy ? { opacity: 0.5 } : null,
        ]}
      >
        {isRecording ? (
          <Animated.View
            style={[
              styles.dot,
              { transform: [{ scale: dotScale }], opacity: dotOpacity },
            ]}
          />
        ) : (
          <Text style={styles.icon}>🎙</Text>
        )}
        <Text style={styles.label}>
          {busy ? t('voiceMicButton.busy') : isRecording ? t('voiceMicButton.stop', { ss }) : restLabel}
        </Text>
      </PressableScale>
    </View>
  );
}

// schemed(): StyleSheet.create runs once at import, so any colour inside it
// would be frozen to whichever palette was active then. Building the sheet per
// scheme costs one extra object at startup and makes the whole file themeable.
const styles = schemed(() => StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'flex-end',
    gap: 8,
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  buttonRec: {
    backgroundColor: colors.danger,
  },
  icon: {
    color: colors.white,
    fontSize: 17,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  errorBubble: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    maxWidth: 240,
  },
  errorText: {
    color: statusTone.failed.fg,
    fontSize: 12,
  },
}));
