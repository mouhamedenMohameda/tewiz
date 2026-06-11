/**
 * Voice recorder hook (expo-av).
 *
 * Lifecycle:
 *   - call start(): requests permission, sets audio mode for recording,
 *                   starts a fresh Recording. Returns true on success.
 *   - call stop():  stops the recording and returns the file URI ready
 *                   to be uploaded.
 *   - unmount:      best-effort cleanup (stops if still recording).
 *
 * State exposed:
 *   - isRecording, durationMs, error
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Audio } from 'expo-av';

interface UseVoiceRecorderState {
  isRecording: boolean;
  durationMs: number;
  error: string | null;
}

interface UseVoiceRecorderApi extends UseVoiceRecorderState {
  start: () => Promise<boolean>;
  stop: () => Promise<string | null>;
  cancel: () => Promise<void>;
}

// Recording quality preset — m4a/aac, mono, 22 kHz. Plenty for STT and
// small enough to upload over 3G in Mauritania (≈30 kB/s).
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

export function useVoiceRecorder(): UseVoiceRecorderApi {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const [state, setState] = useState<UseVoiceRecorderState>({
    isRecording: false,
    durationMs: 0,
    error: null,
  });

  // Best-effort cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        // Ignore errors — we're unmounting.
        rec.stopAndUnloadAsync().catch(() => undefined);
      }
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setState({ isRecording: false, durationMs: 0, error: null });
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setState((s) => ({ ...s, error: 'Permission micro refusée.' }));
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(RECORDING_OPTIONS);
      await rec.startAsync();

      recordingRef.current = rec;
      startedAtRef.current = Date.now();

      // Tick duration every 250 ms — used by the UI for visual feedback.
      tickRef.current = setInterval(() => {
        setState((s) => ({ ...s, durationMs: Date.now() - startedAtRef.current }));
      }, 250);

      setState({ isRecording: true, durationMs: 0, error: null });
      return true;
    } catch (e) {
      setState({
        isRecording: false,
        durationMs: 0,
        error: e instanceof Error ? e.message : 'Erreur d’enregistrement.',
      });
      return false;
    }
  }, []);

  const stop = useCallback(async (): Promise<string | null> => {
    const rec = recordingRef.current;
    if (!rec) return null;

    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    try {
      await rec.stopAndUnloadAsync();
    } catch {
      // ignore — we still want the URI if we have it
    }
    const uri = rec.getURI();
    recordingRef.current = null;
    setState((s) => ({ ...s, isRecording: false }));
    return uri ?? null;
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    const rec = recordingRef.current;
    if (!rec) return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recordingRef.current = null;
    setState({ isRecording: false, durationMs: 0, error: null });
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      // ignore
    }
  }, []);

  return { ...state, start, stop, cancel };
}
