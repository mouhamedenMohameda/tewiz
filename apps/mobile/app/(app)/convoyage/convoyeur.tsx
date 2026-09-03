import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  browseOpenJobs, listMyProposals, propose,
  type MyProposal, type OpenJob, type ProposalStatus,
} from '@/lib/convoyage';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, schemed, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const PROP_COLOR = schemed(() => ({
  pending: colors.warning,
  accepted: colors.success,
  rejected: colors.danger,
  withdrawn: colors.muted,
}));

export default function ConvoyeurScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState<OpenJob[] | null>(null);
  const [mine, setMine] = useState<MyProposal[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([browseOpenJobs(), listMyProposals()]);
      setOpen(o);
      setMine(m);
    } catch {
      setOpen([]);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('convoyage.convoyeur.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      {open === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <AppText variant="overline" color={colors.muted}>{t('convoyage.convoyeur.openMissions')}</AppText>
          {open.length === 0 ? (
            <AppText color={colors.muted} style={{ textAlign: 'center' }}>{t('convoyage.convoyeur.noOpenMissions')}</AppText>
          ) : open.map((j) => <OpenJobCard key={j.id} job={j} onProposed={load} />)}

          {mine.length > 0 ? (
            <>
              <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.md }}>{t('convoyage.convoyeur.myProposals')}</AppText>
              {mine.map((p) => (
                <Card key={p.id} padding={spacing.lg} style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{p.pickupLabel} → {p.dropoffLabel}</AppText>
                    <View style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: PROP_COLOR[p.status] }}>
                      <AppText variant="caption" color={PROP_COLOR[p.status]}>
                        {t(`convoyage.propStatus.${p.status}`)}
                      </AppText>
                    </View>
                  </View>
                  {p.priceMru != null ? <AppText variant="caption" color={colors.muted}>{t('convoyage.convoyeur.yourOffer', { price: formatMru(p.priceMru) })}</AppText> : null}
                  {p.status === 'accepted' && p.clientPhone ? (
                    <Button title={t('convoyage.convoyeur.callBtn', { phone: p.clientPhone })} icon="phone" size="sm"
                      onPress={() => { void Linking.openURL(`tel:${p.clientPhone}`); }} />
                  ) : null}
                </Card>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OpenJobCard({ job, onProposed }: { job: OpenJob; onProposed: () => void }) {
  const { t } = useTranslation();
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await propose(job.id, {
        price_mru: parseInt(price, 10) || undefined,
        note: note.trim() || undefined,
      });
      onProposed();
    } catch (e: any) {
      Alert.alert(t('convoyage.errTitle'), e?.response?.data?.error?.message ?? t('convoyage.convoyeur.errPropose'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
      <AppText variant="label" color={colors.ink}>{job.pickupLabel} → {job.dropoffLabel}</AppText>
      <AppText variant="caption" color={colors.muted}>
        {job.vehicleModel ? `${job.vehicleModel} · ` : ''}{job.clientName}{job.desiredDate ? ` · ${job.desiredDate}` : ''}
      </AppText>
      {job.note ? <AppText variant="body" color={colors.ink2}>{job.note}</AppText> : null}

      {job.alreadyProposed ? (
        <AppText variant="caption" color={colors.success}>{t('convoyage.convoyeur.alreadyProposed')}</AppText>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><TextField value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder={t('convoyage.convoyeur.pricePlaceholder')} /></View>
          </View>
          <TextField value={note} onChangeText={setNote} placeholder={t('convoyage.convoyeur.notePlaceholder')} />
          <Button title={t('convoyage.convoyeur.proposeBtn')} icon="send" size="sm" busy={busy} onPress={submit} />
        </>
      )}
    </Card>
  );
}
