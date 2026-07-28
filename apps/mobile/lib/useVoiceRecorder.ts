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
import { AppState, type AppStateStatus } from 'react-native';
import { Audio } from 'expo-av';
import { i18n } from '@/lib/i18n';

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

interface UseVoiceRecorderOptions {
  // Hard cap on recording length. When reached, the recording is stopped
  // automatically and `onAutoStop` is invoked with the resulting file so the
  // caller can upload it just as if the user had tapped stop. Omit (or 0) to
  // disable the cap. Only opt in together with `onAutoStop`, otherwise the
  // captured audio would be discarded when the cap fires.
  maxDurationMs?: number;
  onAutoStop?: (uri: string | null, durationMs: number) => void;
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Restore a normal playback audio session after recording. Leaving
// `allowsRecordingIOS: true` set routes subsequent playback through the
// earpiece at a low volume on iOS, so we flip it back off once we're done.
// Best-effort: a failure here must never mask the recording result.
async function restorePlaybackMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    // ignore
  }
}

// iOS refuses to activate the AVAudioSession while the app is not in the
// foreground `active` state. That state briefly lags reality right after the
// mic-permission alert closes, during the navigation transition into this
// screen, or when returning from background — which is why the failure was
// intermittent. Wait until AppState is genuinely `active` before touching the
// audio session.
function waitForActive(timeoutMs = 3000): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      resolve(ok);
    };
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') finish(true);
    });
    const timer = setTimeout(() => finish(AppState.currentState === 'active'), timeoutMs);
  });
}

// The native error text for the "app is backgrounded" case. We only auto-retry
// on this specific condition — other failures (no permission, hardware busy)
// should surface immediately rather than spin.
function isBackgroundAudioError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /background|audio session could not be activated/i.test(msg);
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): UseVoiceRecorderApi {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  // Kept in refs so the interval / AppState callbacks always read the latest
  // values without being re-created (which would restart the recording loop).
  const maxDurationRef = useRef<number>(options.maxDurationMs ?? 0);
  maxDurationRef.current = options.maxDurationMs ?? 0;
  const onAutoStopRef = useRef<UseVoiceRecorderOptions['onAutoStop']>(options.onAutoStop);
  onAutoStopRef.current = options.onAutoStop;
  const autoStopRef = useRef<() => void>(() => undefined);

  const [state, setState] = useState<UseVoiceRecorderState>({
    isRecording: false,
    durationMs: 0,
    error: null,
  });

  // Stop the active recording, tear down the tick, restore playback mode and
  // return the file URI. Guarded so concurrent callers (user stop racing the
  // max-duration auto-stop) don't double-unload.
  const finalize = useCallback(async (): Promise<string | null> => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return null;
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      // ignore — we still want the URI if we have it
    }
    await restorePlaybackMode();
    return rec.getURI() ?? null;
  }, []);

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
        setState((s) => ({ ...s, error: i18n.t('rider.voiceRide.permissionDenied') as string }));
        return false;
      }

      // Requesting the permission may have shown a system alert that briefly
      // pushed us out of `active`; make sure we're back before activating the
      // session, then retry a couple of times if iOS still reports background.
      // The whole sequence (setAudioMode → prepare → start) is retried because
      // any of them can trip the "session could not be activated" error, and a
      // fresh Recording object is needed per attempt.
      const MAX_ATTEMPTS = 3;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await waitForActive();

        let rec: Audio.Recording | null = null;
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
          });

          rec = new Audio.Recording();
          await rec.prepareToRecordAsync(RECORDING_OPTIONS);
          await rec.startAsync();

          recordingRef.current = rec;
          startedAtRef.current = Date.now();

          // Tick duration every 250 ms — used by the UI for visual feedback,
          // and to enforce the optional hard cap (auto-stop) so a forgotten
          // recording can't grow into a huge upload.
          tickRef.current = setInterval(() => {
            const elapsed = Date.now() - startedAtRef.current;
            const max = maxDurationRef.current;
            if (max > 0 && elapsed >= max) {
              autoStopRef.current();
              return;
            }
            setState((s) => ({ ...s, durationMs: elapsed }));
          }, 250);

          setState({ isRecording: true, durationMs: 0, error: null });
          return true;
        } catch (e) {
          lastErr = e;
          // Discard the half-prepared recording so the next attempt (and the
          // native side) start clean.
          if (rec) await rec.stopAndUnloadAsync().catch(() => undefined);

          // Only the background condition is transient and worth retrying;
          // wait for foreground + a short backoff, then try again.
          if (isBackgroundAudioError(e) && attempt < MAX_ATTEMPTS - 1) {
            await waitForActive(2000);
            await sleep(300 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }

      throw lastErr ?? new Error('unknown');
    } catch (e) {
      // Show a friendly French message for the (now rare) background failure
      // instead of the raw native English string.
      const message = isBackgroundAudioError(e)
        ? (i18n.t('rider.voiceRide.micUnavailable') as string)
        : e instanceof Error ? e.message : 'Erreur d’enregistrement.';
      setState({ isRecording: false, durationMs: 0, error: message });
      return false;
    }
  }, []);

  const stop = useCallback(async (): Promise<string | null> => {
    if (!recordingRef.current) return null;
    const uri = await finalize();
    setState((s) => ({ ...s, isRecording: false }));
    return uri;
  }, [finalize]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!recordingRef.current) return;
    await finalize();
    setState({ isRecording: false, durationMs: 0, error: null });
  }, [finalize]);

  // Fired from the duration tick when the hard cap is reached: stop, surface
  // the final duration, and hand the file to the caller so it's uploaded just
  // like a manual stop. Kept in a ref so `start`'s interval closure never goes
  // stale. Reassigned each render — cheap and always current.
  autoStopRef.current = () => {
    const elapsed = Date.now() - startedAtRef.current;
    void (async () => {
      const uri = await finalize();
      setState({ isRecording: false, durationMs: elapsed, error: null });
      onAutoStopRef.current?.(uri, elapsed);
    })();
  };

  // If the app is truly backgrounded mid-recording, iOS/Android tear the audio
  // session down (we set staysActiveInBackground: false), which would leave RN
  // state stuck on isRecording: true with a broken recording. Discard it so the
  // UI resets cleanly. Only 'background' — not the transient 'inactive' state
  // seen during navigation transitions or Control Center — triggers this.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' && recordingRef.current) void cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  return { ...state, start, stop, cancel };
}
