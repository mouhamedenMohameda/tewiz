import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Pressable, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { usePolling } from '@/lib/usePolling';
import {
  createVoiceRide, getVoiceRide, cancelVoiceRide,
  type VoiceRideRequest,
} from '@/lib/voiceRides';
import { AppText, Button, Icon } from '@/components/ui';
import { colors, gradients, radius, spacing } from '@/theme';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.espresso }}>
      <View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginTop: spacing.sm,
        }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{
              width: 42, height: 42, borderRadius: radius.md,
              backgroundColor: colors.espressoAlt, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="chevronBack" size={22} color={colors.onEspresso} />
          </Pressable>
          <AppText variant="overline" color={colors.saffron}>Commande vocale</AppText>
          <View style={{ width: 42 }} />
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
          <CenterStatus icon="send" title="Envoi de votre demande…" />
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
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulse]);

  // Expanding "sonar" ring while recording.
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  const secs = Math.floor(durationMs / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <AppText variant="h1" color={colors.onEspresso} align="center">
        {isRecording ? 'À l’écoute…' : 'Dites votre course'}
      </AppText>
      <AppText variant="body" color={colors.onEspressoMuted} align="center" style={{ marginTop: spacing.md, maxWidth: 300 }}>
        {isRecording
          ? 'Indiquez votre point de départ et votre destination, puis appuyez pour arrêter.'
          : 'Appuyez et dites par ex. : « De chez moi à Carrefour Madrid ». Un agent placera votre course.'}
      </AppText>

      <View style={{ marginTop: spacing.mega, width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
        {/* Sonar ring */}
        {isRecording ? (
          <Animated.View
            style={{
              position: 'absolute', width: 132, height: 132, borderRadius: 66,
              borderWidth: 2, borderColor: colors.danger,
              transform: [{ scale: ringScale }], opacity: ringOpacity,
            }}
          />
        ) : null}

        <Pressable onPress={onToggle} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
          <LinearGradient
            colors={isRecording ? ['#E5604A', '#D6452F'] : gradients.ember}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 132, height: 132, borderRadius: 66,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: isRecording ? colors.danger : colors.ember,
              shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 0 },
              elevation: 12,
            }}
          >
            <Icon name={isRecording ? 'close' : 'voice'} size={54} color={colors.white} />
          </LinearGradient>
        </Pressable>
      </View>

      <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: spacing.xl }}>
        {isRecording ? mmss : 'Appuyez pour parler'}
      </AppText>

      {error ? (
        <AppText variant="caption" color="#F4A99A" align="center" style={{ marginTop: spacing.base }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

// ── Waiting phase ────────────────────────────────────────────────────────────
function WaitingView({ onCancel }: { onCancel: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 92, height: 92, borderRadius: 46,
        backgroundColor: 'rgba(246,166,35,0.14)', alignItems: 'center', justifyContent: 'center',
      }}>
        <ActivityIndicator size="large" color={colors.saffron} />
      </View>
      <AppText variant="h1" color={colors.onEspresso} align="center" style={{ marginTop: spacing.xl }}>
        Demande envoyée
      </AppText>
      <AppText variant="body" color={colors.onEspressoMuted} align="center" style={{ marginTop: spacing.md, maxWidth: 300 }}>
        Un agent écoute votre message et prépare votre course. Vous serez notifié dès qu’elle est confirmée.
      </AppText>

      <Pressable
        onPress={() => {
          Alert.alert('Annuler la demande ?', 'Votre demande sera supprimée.', [
            { text: 'Non', style: 'cancel' },
            { text: 'Annuler', style: 'destructive', onPress: onCancel },
          ]);
        }}
        style={({ pressed }) => ({
          marginTop: spacing.huge, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.lg,
          borderWidth: 1.5, borderColor: colors.espressoAlt, backgroundColor: pressed ? colors.espressoAlt : 'transparent',
        })}
      >
        <AppText variant="bodyStrong" color={colors.onEspressoMuted}>Annuler la demande</AppText>
      </Pressable>
    </View>
  );
}

// ── Rejected phase ───────────────────────────────────────────────────────────
function RejectedView({ reason, onRetry }: { reason: string | null; onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 92, height: 92, borderRadius: 46,
        backgroundColor: 'rgba(214,69,47,0.16)', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="alert" size={48} color={colors.danger} />
      </View>
      <AppText variant="h1" color={colors.onEspresso} align="center" style={{ marginTop: spacing.lg }}>
        Demande non aboutie
      </AppText>
      <AppText variant="body" color={colors.onEspressoMuted} align="center" style={{ marginTop: spacing.md, maxWidth: 300 }}>
        {reason ?? 'L’agent n’a pas pu traiter votre message. Réessayez en parlant clairement.'}
      </AppText>
      <Button
        title="Réessayer"
        icon="voice"
        fullWidth={false}
        onPress={onRetry}
        style={{ marginTop: spacing.xl }}
      />
    </View>
  );
}

// ── Generic centered status ──────────────────────────────────────────────────
function CenterStatus({ icon, title }: { icon: 'send'; title: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 92, height: 92, borderRadius: 46,
        backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={42} color={colors.ember} />
      </View>
      <ActivityIndicator size="large" color={colors.ember} style={{ marginTop: spacing.xl }} />
      <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: spacing.base }}>{title}</AppText>
    </View>
  );
}
