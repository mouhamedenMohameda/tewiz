import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { acceptProposal, getJobProposals, type Proposal } from '@/lib/convoyage';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader } from '@/components/ui';
import { colors, spacing } from '@/theme';

export default function ConvoyageProposalsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try { setProposals(await getJobProposals(id)); } catch { setProposals([]); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  function choose(p: Proposal) {
    Alert.alert('Choisir ce convoyeur ?', `${p.providerName}${p.priceMru != null ? ` · ${formatMru(p.priceMru)}` : ''}`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Choisir',
        onPress: async () => {
          setBusy(p.id);
          try {
            await acceptProposal(id!, p.id);
            Alert.alert('Convoyeur choisi', 'Son numéro est disponible dans « Convoyage ».', [
              { text: 'OK', onPress: () => router.replace('/(app)/convoyage') },
            ]);
          } catch (e: any) {
            Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Action impossible.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title="Propositions" onBack={() => router.back()} />
      {proposals === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={proposals}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              Aucune proposition pour le moment. Les convoyeurs vont répondre.
            </AppText>
          }
          renderItem={({ item }) => (
            <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink}>
                  {item.providerName}{item.providerRating != null ? `  ⭐ ${item.providerRating.toFixed(1)}` : ''}
                </AppText>
                {item.priceMru != null ? <AppText variant="label" color={colors.ember}>{formatMru(item.priceMru)}</AppText> : null}
              </View>
              {item.note ? <AppText variant="body" color={colors.ink2}>{item.note}</AppText> : null}
              <Button title="Choisir ce convoyeur" icon="check" size="sm" busy={busy === item.id} onPress={() => choose(item)} />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}
