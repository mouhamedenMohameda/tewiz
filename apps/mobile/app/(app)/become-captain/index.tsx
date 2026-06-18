import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type ApplicationDto, type ApplicationStatus,
  DOCUMENT_ORDER, docsComplete, personalFieldsComplete, vehicleFieldsComplete,
} from '@/lib/kyc';
import { APP_NAME } from '@/lib/brand';

export default function BecomeCaptainHome() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const setActiveMode = useAuth((s) => s.setActiveMode);
  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<ApplicationDto | null>('/captain/applications/me');
      setApp(r.data);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  // Refresh whenever the user comes back from a child screen.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (app?.status !== 'approved') return;
    // Application just got approved → promote the locally cached user to
    // captain and switch them into captain mode. The server already flipped
    // the role; we sync the client so the toggle and captain UI appear.
    (async () => {
      if (user && user.role !== 'captain') {
        await setUser({ ...user, role: 'captain' });
      }
      await setActiveMode('captain');
      router.replace('/(app)/captain');
    })();
  }, [app?.status, router, setUser, setActiveMode, user]);

  async function startApplication() {
    setCreating(true);
    try {
      const r = await api.post<ApplicationDto>('/captain/applications');
      setApp(r.data);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.createFail'));
    } finally {
      setCreating(false);
    }
  }

  async function submitApplication() {
    if (!app) return;
    setSubmitting(true);
    try {
      const r = await api.post<ApplicationDto>('/captain/applications/me/submit');
      setApp(r.data);
      Alert.alert(t('becomeCaptain.submittedTitle'), t('becomeCaptain.submittedBody'));
    } catch (e: any) {
      const data = e.response?.data?.error;
      const missing = data?.details?.missing as string[] | undefined;
      Alert.alert(
        t('becomeCaptain.incompleteTitle'),
        missing?.length
          ? t('becomeCaptain.missingPrefix', { items: missing.join('\n• ') })
          : (data?.message ?? t('becomeCaptain.completeAllSteps')),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const editable = !!app && (app.status === 'draft' || app.status === 'needs_correction');
  const allComplete = !!app && personalFieldsComplete(app) && vehicleFieldsComplete(app) && docsComplete(app);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '600' }}>‹ {t('common.back')}</Text>
          </Pressable>
          <Text style={{ fontSize: 13, color: '#64748b' }}>{user?.phone}</Text>
        </View>

        <Text style={{ fontSize: 28, fontWeight: '700', color: '#0f172a', marginTop: 24 }}>
          {t('becomeCaptain.title', { app: APP_NAME })}
        </Text>

        {!app
          ? <NoApplication onStart={startApplication} busy={creating} />
          : (
            <View style={{ marginTop: 16 }}>
              <StatusBanner status={app.status} />

              {app.status === 'rejected' && app.rejectReason ? (
                <ErrorCard title={t('becomeCaptain.rejectReason')} body={app.rejectReason} />
              ) : null}

              <StepCard
                index={1}
                title={t('becomeCaptain.stepPersonalTitle')}
                subtitle={t('becomeCaptain.stepPersonalSub')}
                done={personalFieldsComplete(app)}
                editable={editable}
                onPress={() => router.push('/(app)/become-captain/personal')}
              />
              <StepCard
                index={2}
                title={t('becomeCaptain.stepVehicleTitle')}
                subtitle={t('becomeCaptain.stepVehicleSub')}
                done={vehicleFieldsComplete(app)}
                editable={editable}
                onPress={() => router.push('/(app)/become-captain/vehicle')}
              />
              <StepCard
                index={3}
                title={t('becomeCaptain.stepDocsTitle')}
                subtitle={t('becomeCaptain.stepDocsSub', { done: app.documents.length, total: DOCUMENT_ORDER.length })}
                done={docsComplete(app)}
                editable={editable}
                onPress={() => router.push('/(app)/become-captain/documents')}
              />

              {editable ? (
                <Pressable
                  disabled={!allComplete || submitting}
                  onPress={submitApplication}
                  style={({ pressed }) => ({
                    marginTop: 24,
                    backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
                    opacity: !allComplete || submitting ? 0.5 : 1,
                    paddingVertical: 16, borderRadius: 12,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  })}
                >
                  {submitting && <ActivityIndicator color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                    {allComplete ? t('becomeCaptain.submit') : t('becomeCaptain.completeFirst')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
      </ScrollView>
    </SafeAreaView>
  );
}

function NoApplication({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 15, color: '#475569', lineHeight: 22 }}>
        {t('becomeCaptain.intro', { app: APP_NAME })}
      </Text>
      <Pressable
        disabled={busy}
        onPress={onStart}
        style={({ pressed }) => ({
          marginTop: 24,
          backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
          opacity: busy ? 0.5 : 1,
          paddingVertical: 16, borderRadius: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        })}
      >
        {busy && <ActivityIndicator color="#fff" />}
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
          {t('becomeCaptain.start')}
        </Text>
      </Pressable>
    </View>
  );
}

function StepCard({
  index, title, subtitle, done, editable, onPress,
}: {
  index: number; title: string; subtitle: string;
  done: boolean; editable: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      disabled={!editable && done}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 12, backgroundColor: pressed ? '#f1f5f9' : '#fff',
        borderRadius: 14, padding: 16,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        borderWidth: 1, borderColor: done ? '#bbf7d0' : '#e2e8f0',
      })}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: done ? '#10a35e' : '#e2e8f0',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: done ? '#fff' : '#475569', fontWeight: '700' }}>
          {done ? '✓' : index}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{title}</Text>
        <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: '#94a3b8', fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={{
      marginTop: 16, backgroundColor: '#fef2f2', borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: '#fecaca',
    }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: '#b91c1c' }}>{title}</Text>
      <Text style={{ fontSize: 13, color: '#7f1d1d', marginTop: 6 }}>{body}</Text>
    </View>
  );
}

function StatusBanner({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const palette: Record<ApplicationStatus, { bg: string; fg: string }> = {
    draft:            { bg: '#fef9c3', fg: '#854d0e' },
    submitted:        { bg: '#dbeafe', fg: '#1e40af' },
    under_review:     { bg: '#e0e7ff', fg: '#3730a3' },
    needs_correction: { bg: '#fef3c7', fg: '#92400e' },
    approved:         { bg: '#dcfce7', fg: '#166534' },
    rejected:         { bg: '#fee2e2', fg: '#991b1b' },
  };
  const s = palette[status];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 14, padding: 16 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
        {t(`becomeCaptain.banner.${status}.label` as const).toUpperCase()}
      </Text>
      <Text style={{ color: s.fg, fontSize: 14, marginTop: 4, lineHeight: 20 }}>
        {t(`becomeCaptain.banner.${status}.desc` as const, { app: APP_NAME })}
      </Text>
    </View>
  );
}
