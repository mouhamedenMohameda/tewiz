import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { acceptProposal, getJobProposals, type Proposal } from '@/lib/convoyage';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function ConvoyageProposalsScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
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
    Alert.alert(t('convoyage.proposals.confirmTitle'), `${p.providerName}${p.priceMru != null ? ` · ${formatMru(p.priceMru)}` : ''}`, [
      { text: t('convoyage.proposals.cancelBtn'), style: 'cancel' },
      {
        text: t('convoyage.proposals.chooseYes'),
        onPress: async () => {
          setBusy(p.id);
          try {
            await acceptProposal(id!, p.id);
            Alert.alert(t('convoyage.proposals.chosenTitle'), t('convoyage.proposals.chosenBody'), [
              { text: t('common.ok'), onPress: () => router.replace('/(app)/convoyage') },
            ]);
          } catch (e: any) {
            Alert.alert(t('convoyage.errTitle'), e?.response?.data?.error?.message ?? t('convoyage.proposals.errAction'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('convoyage.proposals.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
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
              {t('convoyage.proposals.empty')}
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
              <Button title={t('convoyage.proposals.chooseBtn')} icon="check" size="sm" busy={busy === item.id} onPress={() => choose(item)} />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}
