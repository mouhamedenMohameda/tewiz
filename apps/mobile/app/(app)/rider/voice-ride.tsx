import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Pressable, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { usePolling } from '@/lib/usePolling';
import {
  createVoiceRide, getVoiceRide, cancelVoiceRide,
  type VoiceRideRequest,
} from '@/lib/voiceRides';

type Phase = 'record' | 'uploading' | 'waiting' | 'rejected';

const MIN_RECORD_MS = 1200;

export default function VoiceRideScreen() {
  const router = useRouter();
  const recorder = useVoiceRecorder();

  const [phase, setPhase] = useState<Phase>('record');
  const [request, setRequest] = useState<VoiceRideRequest | null>(null);
  const requestId = request?.id ?? null;

  // ── Recording → upload ─────────────────────────────────────────────────────
  const onToggleRecord = useCallback(async () => {
    if (recorder.isRecording) {
      const durationMs = recorder.durationMs;
      const uri = await recorder.stop();
      if (!uri) return;
      if (durationMs < MIN_RECORD_MS) {
        Alert.alert('Trop court', 'Maintenez et parlez un peu plus longtemps.');
        return;
      }
      setPhase('uploading');
      try {
        const req = await createVoiceRide(uri, Math.round(durationMs / 1000));
        setRequest(req);
        setPhase('waiting');
      } catch (e: any) {
        setPhase('record');
        const code = e?.response?.data?.error;
        Alert.alert(
          'Échec de l’envoi',
          code === 'voice_request_pending'
            ? 'Vous avez déjà une demande en cours.'
            : (e?.response?.data?.message ?? 'Réessayez.'),
        );
      }
    } else {
      await recorder.start();
    }
  }, [recorder]);

  // ── Waiting → poll for status ──────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!requestId) return;
    try {
      const req = await getVoiceRide(requestId);
      setRequest(req);
      if (req.status === 'confirmed' && req.rideId) {
        // Ride created — jump straight to tracking.
        router.replace('/(app)/rider/current');
      } else if (req.status === 'rejected') {
        setPhase('rejected');
      } else if (req.status === 'cancelled') {
        setPhase('record');
        setRequest(null);
      }
    } catch {
      // Transient — keep polling.
    }
  }, [requestId, router]);

  // Initial fetch on entering the waiting phase, then poll every 4 s.
  useEffect(() => {
    if (phase === 'waiting') void refresh();
  }, [phase, refresh]);
  usePolling(() => { if (phase === 'waiting') void refresh(); }, 4_000);

  const onCancel = useCallback(async () => {
    if (!requestId) return;
    try {
      await cancelVoiceRide(requestId);
    } catch {
      // Even if it already moved on, fall through to reset.
    }
    setRequest(null);
    setPhase('record');
  }, [requestId]);

  const onRetry = useCallback(() => {
    setRequest(null);
    setPhase('record');
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <View style={{ flex: 1, padding: 24 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={{ color: '#cbd5e1', fontSize: 15 }}>‹ Retour</Text>
          </Pressable>
          <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
            COMMANDE VOCALE
          </Text>
          <View style={{ width: 56 }} />
        </View>

        {phase === 'record' && (
          <RecordView
            isRecording={recorder.isRecording}
            durationMs={recorder.durationMs}
            error={recorder.error}
            onToggle={onToggleRecord}
          />
        )}

        {phase === 'uploading' && (
          <CenterStatus emoji="📤" title="Envoi de votre demande…" />
        )}

        {phase === 'waiting' && (
          <WaitingView onCancel={onCancel} />
        )}

        {phase === 'rejected' && (
          <RejectedView reason={request?.rejectReason ?? null} onRetry={onRetry} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Record phase ─────────────────────────────────────────────────────────────
function RecordView({
  isRecording, durationMs, error, onToggle,
}: {
  isRecording: boolean; durationMs: number; error: string | null; onToggle: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isRecording) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  const secs = Math.floor(durationMs / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center' }}>
        {isRecording ? 'À l’écoute…' : 'Dites votre course'}
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20, maxWidth: 300 }}>
        {isRecording
          ? 'Indiquez votre point de départ et votre destination, puis appuyez pour arrêter.'
          : 'Appuyez et dites par exemple : « De chez moi à Carrefour Madrid ». Un agent placera votre course.'}
      </Text>

      <Animated.View style={{ marginTop: 48, transform: [{ scale }] }}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => ({
            width: 132, height: 132, borderRadius: 66,
            backgroundColor: isRecording ? '#dc2626' : '#10a35e',
            alignItems: 'center', justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
            shadowColor: isRecording ? '#dc2626' : '#10a35e',
            shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
          })}
        >
          <Text style={{ fontSize: 52 }}>{isRecording ? '⏹' : '🎙'}</Text>
        </Pressable>
      </Animated.View>

      <Text style={{ color: '#e2e8f0', fontSize: 18, fontWeight: '600', marginTop: 28 }}>
        {isRecording ? mmss : 'Appuyez pour parler'}
      </Text>

      {error ? (
        <Text style={{ color: '#fca5a5', fontSize: 13, marginTop: 16, textAlign: 'center' }}>{error}</Text>
      ) : null}
    </View>
  );
}

// ── Waiting phase ────────────────────────────────────────────────────────────
function WaitingView({ onCancel }: { onCancel: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#10a35e" />
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 28, textAlign: 'center' }}>
        Demande envoyée
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20, maxWidth: 300 }}>
        Un agent écoute votre message et prépare votre course. Vous serez notifié dès qu’elle est confirmée.
      </Text>

      <Pressable
        onPress={() => {
          Alert.alert('Annuler la demande ?', 'Votre demande sera supprimée.', [
            { text: 'Non', style: 'cancel' },
            { text: 'Annuler', style: 'destructive', onPress: onCancel },
          ]);
        }}
        style={({ pressed }) => ({
          marginTop: 40, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12,
          borderWidth: 1, borderColor: '#475569', backgroundColor: pressed ? '#1e293b' : 'transparent',
        })}
      >
        <Text style={{ color: '#cbd5e1', fontSize: 15, fontWeight: '600' }}>Annuler la demande</Text>
      </Pressable>
    </View>
  );
}

// ── Rejected phase ───────────────────────────────────────────────────────────
function RejectedView({ reason, onRetry }: { reason: string | null; onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 56 }}>😕</Text>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
        Demande non aboutie
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20, maxWidth: 300 }}>
        {reason ?? 'L’agent n’a pas pu traiter votre message. Réessayez en parlant clairement.'}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 36, paddingVertical: 15, paddingHorizontal: 40, borderRadius: 12,
          backgroundColor: pressed ? '#0a9050' : '#10a35e',
        })}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

// ── Generic centered status ──────────────────────────────────────────────────
function CenterStatus({ emoji, title }: { emoji: string; title: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 48 }}>{emoji}</Text>
      <ActivityIndicator size="large" color="#10a35e" style={{ marginTop: 20 }} />
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 20 }}>{title}</Text>
    </View>
  );
}
