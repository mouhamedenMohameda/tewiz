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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';

interface Props {
  onCaptured: (audioUri: string) => void;
  /** Show an external loading indicator while the parent uploads. */
  busy?: boolean;
  /** Optional label shown next to the icon (defaults to "Parler"). */
  label?: string;
  /** Optional position override; defaults to bottom-right of the screen. */
  bottom?: number;
  right?: number;
}

export function VoiceMicButton({
  onCaptured,
  busy = false,
  label = 'Parler',
  bottom = 96,
  right = 16,
}: Props) {
  const { isRecording, durationMs, error, start, stop } = useVoiceRecorder();

  // Pulse animation for the red dot while recording.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isRecording) {
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
  }, [isRecording, pulse]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.4] });

  async function onPress() {
    if (busy) return;
    if (isRecording) {
      const uri = await stop();
      if (uri) onCaptured(uri);
    } else {
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

      <Pressable
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => [
          styles.button,
          isRecording && styles.buttonRec,
          pressed && { opacity: 0.85 },
          busy && { opacity: 0.5 },
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
          {busy ? '…' : isRecording ? `Arrêter · 0:${ss}` : label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'flex-end',
    gap: 8,
  },
  button: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
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
    backgroundColor: '#dc2626',
  },
  icon: {
    color: '#fff',
    fontSize: 18,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBubble: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    maxWidth: 240,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 12,
  },
});
