import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  PROBLEM_META,
  PROBLEM_ORDER,
  cancelRoadside,
  createRoadside,
  getCurrentRoadside,
  type ProblemType,
  type RoadsideRequest,
} from '@/lib/roadside';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function RoadsideScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState<RoadsideRequest | null | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemType | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notified, setNotified] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCurrent(await getCurrentRoadside());
    } catch {
      setCurrent(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(refresh, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  async function requestHelp() {
    if (!problem) return;
    setSubmitting(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location refusée');
      const loc = await Location.getCurrentPositionAsync();
      const res = await createRoadside({
        problem_type: problem,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        note: note.trim() || undefined,
      });
      setNotified(res.providersNotified);
      setCurrent(res.request);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Impossible d\'envoyer la demande.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!current) return;
    try {
      await cancelRoadside(current.id);
      setCurrent(null);
      setProblem(null);
      setNotified(null);
    } catch {
      Alert.alert('Erreur', 'Annulation impossible.');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title="Assistance Routière" onBack={() => router.back()} />
      <View style={{ flex: 1, padding: spacing.lg }}>
        {current === undefined ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} />
        ) : current === null ? (
          <PickProblem
            problem={problem}
            onPick={setProblem}
            submitting={submitting}
            onRequest={requestHelp}
          />
        ) : current.status === 'searching' ? (
          <Searching request={current} notified={notified} onCancel={cancel} />
        ) : current.status === 'unresolved' ? (
          <Unresolved request={current} onCancel={cancel} />
        ) : (
          <Accepted request={current} onCancel={cancel} />
        )}
      </View>
    </SafeAreaView>
  );
}

function PickProblem({ problem, onPick, submitting, onRequest }: {
  problem: ProblemType | null;
  onPick: (p: ProblemType) => void;
  submitting: boolean;
  onRequest: () => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View>
        <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
          Quel est votre problème ? Un dépanneur proche sera prévenu.
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {PROBLEM_ORDER.map((p) => {
            const active = problem === p;
            return (
              <Pressable
                key={p}
                onPress={() => onPick(p)}
                style={{
                  width: '47%',
                  paddingVertical: spacing.lg,
                  borderRadius: radius.lg,
                  borderWidth: 2,
                  borderColor: active ? colors.ember : colors.line,
                  backgroundColor: active ? colors.emberSoft : '#fff',
                  alignItems: 'center',
                  gap: spacing.xs,
                }}
              >
                <AppText variant="h2">{PROBLEM_META[p].emoji}</AppText>
                <AppText variant="label" color={active ? colors.ember : colors.ink}>
                  {PROBLEM_META[p].label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Button
        title="🆘 Demander de l'aide"
        onPress={onRequest}
        busy={submitting}
        disabled={!problem}
      />
    </View>
  );
}

function Searching({ request, notified, onCancel }: {
  request: RoadsideRequest;
  notified: number | null;
  onCancel: () => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
        <ActivityIndicator size="large" color={colors.ember} />
        <AppText variant="h2" color={colors.ink} style={{ marginTop: spacing.lg }}>
          {PROBLEM_META[request.problemType].emoji} Recherche d'un dépanneur…
        </AppText>
        <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
          {notified != null && notified > 0
            ? `${notified} dépanneur${notified > 1 ? 's' : ''} prévenu${notified > 1 ? 's' : ''} autour de vous`
            : 'Nous élargissons la recherche…'}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs }}>
          Rayon : {(request.searchRadiusM / 1000).toFixed(0)} km
        </AppText>
      </View>
      <Button title="Annuler la demande" variant="secondary" onPress={onCancel} />
    </View>
  );
}

function Accepted({ request, onCancel }: { request: RoadsideRequest; onCancel: () => void }) {
  const p = request.provider;
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View>
        <AppText variant="body" color={colors.success} style={{ marginBottom: spacing.md }}>
          ✅ Un dépanneur arrive vers vous
        </AppText>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label" color={colors.ink}>{p?.name ?? 'Dépanneur'}</AppText>
            {p?.ratingAvg != null ? (
              <AppText variant="body" color={colors.warning}>⭐ {p.ratingAvg.toFixed(1)}</AppText>
            ) : null}
          </View>
          <AppText variant="caption" color={colors.muted}>
            {PROBLEM_META[request.problemType].label}
          </AppText>
          {p?.phone ? (
            <Button
              title={`Appeler ${p.phone}`}
              icon="phone"
              onPress={() => { void Linking.openURL(`tel:${p.phone}`); }}
            />
          ) : null}
        </Card>
      </View>
      <Button title="Terminer / Annuler" variant="secondary" onPress={onCancel} />
    </View>
  );
}

function Unresolved({ request, onCancel }: { request: RoadsideRequest; onCancel: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View style={{ marginTop: spacing.xl }}>
        <AppText variant="h2" color={colors.ink}>Aucun dépanneur disponible</AppText>
        <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
          Personne n'a répondu à proximité. Appelez notre numéro vert, un opérateur
          vous trouvera une solution.
        </AppText>
      </View>
      <View style={{ gap: spacing.sm }}>
        {request.hotlinePhone ? (
          <Button
            title={`📞 Numéro vert · ${request.hotlinePhone}`}
            icon="phone"
            onPress={() => { void Linking.openURL(`tel:${request.hotlinePhone}`); }}
          />
        ) : (
          <AppText variant="caption" color={colors.muted} style={{ textAlign: 'center' }}>
            Numéro vert non configuré.
          </AppText>
        )}
        <Button title="Fermer" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}
