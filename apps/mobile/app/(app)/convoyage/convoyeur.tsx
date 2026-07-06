import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  JOB_STATUS_LABEL, browseOpenJobs, listMyProposals, propose,
  type MyProposal, type OpenJob, type ProposalStatus,
} from '@/lib/convoyage';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

const PROP_COLOR: Record<ProposalStatus, string> = {
  pending: colors.warning,
  accepted: colors.success,
  rejected: colors.danger,
  withdrawn: colors.muted,
};

export default function ConvoyeurScreen() {
  const router = useRouter();
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
      <ScreenHeader title="Convoyeur" onBack={() => router.back()} />
      {open === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <AppText variant="overline" color={colors.muted}>MISSIONS OUVERTES</AppText>
          {open.length === 0 ? (
            <AppText color={colors.muted} style={{ textAlign: 'center' }}>Aucune mission ouverte.</AppText>
          ) : open.map((j) => <OpenJobCard key={j.id} job={j} onProposed={load} />)}

          {mine.length > 0 ? (
            <>
              <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.md }}>MES PROPOSITIONS</AppText>
              {mine.map((p) => (
                <Card key={p.id} padding={spacing.lg} style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{p.pickupLabel} → {p.dropoffLabel}</AppText>
                    <View style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: PROP_COLOR[p.status] }}>
                      <AppText variant="caption" color={PROP_COLOR[p.status]}>
                        {p.status === 'accepted' ? 'Choisi ✅' : p.status === 'rejected' ? 'Non retenu' : p.status === 'pending' ? 'En attente' : 'Retiré'}
                      </AppText>
                    </View>
                  </View>
                  {p.priceMru != null ? <AppText variant="caption" color={colors.muted}>Votre offre : {formatMru(p.priceMru)}</AppText> : null}
                  {p.status === 'accepted' && p.clientPhone ? (
                    <Button title={`Appeler ${p.clientPhone}`} icon="phone" size="sm"
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
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Proposition impossible.');
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
        <AppText variant="caption" color={colors.success}>✅ Déjà proposé</AppText>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><TextField value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="Prix (MRU, optionnel)" /></View>
          </View>
          <TextField value={note} onChangeText={setNote} placeholder="Note (optionnel)" />
          <Button title="Se proposer" icon="send" size="sm" busy={busy} onPress={submit} />
        </>
      )}
    </Card>
  );
}
