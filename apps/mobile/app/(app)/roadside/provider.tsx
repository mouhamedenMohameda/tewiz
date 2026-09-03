import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import {
  PROBLEM_META,
  PROBLEM_ORDER,
  acceptRoadside,
  declineRoadside,
  getRoadsideProfile,
  roadsideInbox,
  setRoadsideProfile,
  type AcceptResult,
  type ProblemType,
  type ProviderInboxItem,
} from '@/lib/roadside';
import { AppText, Button, Card, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { wrapRow } from '@/components/ui';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function RoadsideProviderScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [offers, setOffers] = useState(false);
  const [specialties, setSpecialties] = useState<ProblemType[]>([]);
  const [inbox, setInbox] = useState<ProviderInboxItem[]>([]);
  const [accepted, setAccepted] = useState<AcceptResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getRoadsideProfile()
      .then((p) => { setOffers(p.offersRoadside); setSpecialties(p.specialties); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const req = await Location.requestForegroundPermissionsAsync();
        if (!req.granted) return;
      }
      const loc = await Location.getCurrentPositionAsync();
      setInbox(await roadsideInbox(loc.coords.latitude, loc.coords.longitude));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (offers && !accepted) {
      void loadInbox();
      timer.current = setInterval(loadInbox, 10000);
      return () => { if (timer.current) clearInterval(timer.current); };
    }
    if (timer.current) clearInterval(timer.current);
    return undefined;
  }, [offers, accepted, loadInbox]);

  async function toggleOffers(v: boolean) {
    setOffers(v);
    try {
      await setRoadsideProfile(v, specialties);
    } catch {
      setOffers(!v);
      Alert.alert(t('roadside.errTitle'), t('roadside.provider.errUpdate'));
    }
  }

  async function toggleSpecialty(p: ProblemType) {
    const next = specialties.includes(p) ? specialties.filter((s) => s !== p) : [...specialties, p];
    setSpecialties(next);
    try { await setRoadsideProfile(offers, next); } catch { /* ignore */ }
  }

  async function accept(id: string) {
    try {
      setAccepted(await acceptRoadside(id));
    } catch (e: any) {
      Alert.alert(t('roadside.provider.errAcceptedTitle'), e?.response?.data?.error?.message ?? t('roadside.provider.errAcceptedBody'));
      void loadInbox();
    }
  }

  async function decline(id: string) {
    try { await declineRoadside(id); } catch { /* ignore */ }
    setInbox((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title={t('roadside.headerProvider')} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }

  if (accepted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader title={t('roadside.headerAccepted')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
          <View>
            <AppText variant="body" color={colors.success} style={{ marginBottom: spacing.md }}>
              {t('roadside.provider.acceptedIntroBtn')}
            </AppText>
            <Card padding={spacing.lg} style={{ gap: spacing.md }}>
              <AppText variant="h2">{PROBLEM_META[accepted.problem_type].emoji} {t(PROBLEM_META[accepted.problem_type].labelKey)}</AppText>
              {accepted.note ? <AppText variant="body" color={colors.ink2}>{accepted.note}</AppText> : null}
              <AppText variant="label" color={colors.ink}>{accepted.requester_name}</AppText>
              <Button
                title={t('roadside.accepted.callBtn', { phone: accepted.requester_phone })}
                icon="phone"
                onPress={() => { void Linking.openURL(`tel:${accepted.requester_phone}`); }}
              />
              <Button
                title={t('roadside.provider.routeBtn')}
                variant="secondary"
                icon="map"
                onPress={() => {
                  const { lat, lng } = accepted.location;
                  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                }}
              />
            </Card>
          </View>
          <Button title={t('roadside.provider.closeBtn')} variant="secondary" onPress={() => { setAccepted(null); void loadInbox(); }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('roadside.headerProvider')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label" color={colors.ink}>{t('roadside.provider.offersLabel')}</AppText>
            <Switch value={offers} onValueChange={toggleOffers} />
          </View>
          <AppText variant="caption" color={colors.muted}>
            {t('roadside.provider.offersDesc')}
          </AppText>
        </Card>

        {offers ? (
          <>
            <View>
              <AppText variant="caption" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
                {t('roadside.provider.specialtiesLabel')}
              </AppText>
              <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.xs }}>
                {PROBLEM_ORDER.map((p) => {
                  const on = specialties.includes(p);
                  return (
                    <Pressable
                      key={p}
                      onPress={() => toggleSpecialty(p)}
                      style={{
                        paddingVertical: spacing.xs,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.pill,
                        borderWidth: 1.5,
                        borderColor: on ? colors.ember : colors.line,
                        backgroundColor: on ? colors.emberSoft : '#fff',
                      }}
                    >
                      <AppText variant="caption" color={on ? colors.ember : colors.ink2}>
                        {PROBLEM_META[p].emoji} {t(PROBLEM_META[p].labelKey)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View>
              <AppText variant="caption" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
                {t('roadside.provider.inboxLabel')}
              </AppText>
              {inbox.length === 0 ? (
                <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.lg }}>
                  {t('roadside.provider.inboxEmpty')}
                </AppText>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {inbox.map((r) => (
                    <Card key={r.id} padding={spacing.lg} style={{ gap: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <AppText variant="label" color={colors.ink}>
                          {PROBLEM_META[r.problemType].emoji} {t(PROBLEM_META[r.problemType].labelKey)}
                        </AppText>
                        <AppText variant="caption" color={colors.muted}>
                          {t('roadside.provider.distanceKm', { km: (r.distanceM / 1000).toFixed(1) })}
                        </AppText>
                      </View>
                      {r.note ? <AppText variant="body" color={colors.ink2}>{r.note}</AppText> : null}
                      <AppText variant="caption" color={colors.muted}>{r.requesterName}</AppText>
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <Button title={t('roadside.provider.acceptBtn')} size="sm" onPress={() => accept(r.id)} style={{ flex: 1 }} />
                        <Button title={t('roadside.provider.declineBtn')} size="sm" variant="secondary" onPress={() => decline(r.id)} style={{ flex: 1 }} />
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
