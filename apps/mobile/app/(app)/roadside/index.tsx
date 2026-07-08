import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
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
import { AppText, Button, Card, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function RoadsideScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
      Alert.alert(t('roadside.errTitle'), e?.response?.data?.error?.message ?? t('roadside.pick.errSend'));
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
      Alert.alert(t('roadside.errTitle'), t('roadside.searching.errCancel'));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('roadside.headerRider')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
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
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View>
        <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
          {t('roadside.pick.prompt')}
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
                  {t(PROBLEM_META[p].labelKey)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Button
        title={t('roadside.pick.requestBtn')}
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
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
        <ActivityIndicator size="large" color={colors.ember} />
        <AppText variant="h2" color={colors.ink} style={{ marginTop: spacing.lg }}>
          {t('roadside.searching.title', { emoji: PROBLEM_META[request.problemType].emoji })}
        </AppText>
        <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
          {notified != null && notified > 0
            ? (notified > 1
              ? t('roadside.searching.notifiedMany', { count: notified })
              : t('roadside.searching.notifiedOne', { count: notified }))
            : t('roadside.searching.expanding')}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs }}>
          {t('roadside.searching.radius', { km: (request.searchRadiusM / 1000).toFixed(0) })}
        </AppText>
      </View>
      <Button title={t('roadside.searching.cancelBtn')} variant="secondary" onPress={onCancel} />
    </View>
  );
}

function Accepted({ request, onCancel }: { request: RoadsideRequest; onCancel: () => void }) {
  const { t } = useTranslation();
  const p = request.provider;
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View>
        <AppText variant="body" color={colors.success} style={{ marginBottom: spacing.md }}>
          {t('roadside.accepted.arriving')}
        </AppText>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label" color={colors.ink}>{p?.name ?? t('roadside.accepted.providerFallback')}</AppText>
            {p?.ratingAvg != null ? (
              <AppText variant="body" color={colors.warning}>⭐ {p.ratingAvg.toFixed(1)}</AppText>
            ) : null}
          </View>
          <AppText variant="caption" color={colors.muted}>
            {t(PROBLEM_META[request.problemType].labelKey)}
          </AppText>
          {p?.phone ? (
            <Button
              title={t('roadside.accepted.callBtn', { phone: p.phone })}
              icon="phone"
              onPress={() => { void Linking.openURL(`tel:${p.phone}`); }}
            />
          ) : null}
        </Card>
      </View>
      <Button title={t('roadside.accepted.endBtn')} variant="secondary" onPress={onCancel} />
    </View>
  );
}

function Unresolved({ request, onCancel }: { request: RoadsideRequest; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View style={{ marginTop: spacing.xl }}>
        <AppText variant="h2" color={colors.ink}>{t('roadside.unresolved.title')}</AppText>
        <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
          {t('roadside.unresolved.body')}
        </AppText>
      </View>
      <View style={{ gap: spacing.sm }}>
        {request.hotlinePhone ? (
          <Button
            title={t('roadside.unresolved.hotlineBtn', { phone: request.hotlinePhone })}
            icon="phone"
            onPress={() => { void Linking.openURL(`tel:${request.hotlinePhone}`); }}
          />
        ) : (
          <AppText variant="caption" color={colors.muted} style={{ textAlign: 'center' }}>
            {t('roadside.unresolved.hotlineMissing')}
          </AppText>
        )}
        <Button title={t('roadside.unresolved.closeBtn')} variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}
