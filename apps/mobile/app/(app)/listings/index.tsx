import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, RefreshControl, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CATEGORY_META,
  PRICE_UNIT_SUFFIX,
  listListings,
  revealListingContact,
  type ServiceListing,
} from '@/lib/listings';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function ListingsBrowseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const category = params.category ?? 'car_rental';
  const meta = CATEGORY_META[category];

  const [listings, setListings] = useState<ServiceListing[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listListings(category);
      setListings(rows);
    } catch {
      setListings([]);
    }
  }, [category]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function reveal(id: string) {
    setRevealing(id);
    try {
      const c = await revealListingContact(id);
      setRevealed((prev) => ({ ...prev, [id]: c.providerPhone }));
    } catch {
      /* ignore */
    } finally {
      setRevealing(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader
        title={meta?.label ?? 'Annonces'}
        onBack={() => router.back()}
      />

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Button
          title="Publier mon annonce"
          icon="send"
          size="sm"
          onPress={() => router.push(`/(app)/listings/publish?category=${category}`)}
        />
      </View>

      {listings === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              Aucune annonce pour le moment.
            </AppText>
          }
          renderItem={({ item }) => {
            const phone = revealed[item.id];
            const suffix = PRICE_UNIT_SUFFIX[item.priceUnit];
            return (
              <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="label" color={colors.ink} style={{ flex: 1, paddingEnd: spacing.sm }}>
                    {item.title}
                  </AppText>
                  <AppText variant="label" color={colors.ember}>
                    {formatMru(item.priceMru)}{suffix}
                  </AppText>
                </View>

                {item.description ? (
                  <AppText variant="body" color={colors.ink2}>{item.description}</AppText>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <Icon name="drivers" size={14} color={colors.muted} />
                  <AppText variant="caption" color={colors.muted}>{item.providerName}</AppText>
                </View>

                {phone ? (
                  <View
                    style={{
                      marginTop: spacing.xs,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: colors.successSoft,
                      borderRadius: radius.md,
                      padding: spacing.md,
                    }}
                  >
                    <AppText variant="label" color={colors.success}>{phone}</AppText>
                    <Button
                      title="Appeler"
                      icon="phone"
                      size="sm"
                      onPress={() => { void Linking.openURL(`tel:${phone}`); }}
                    />
                  </View>
                ) : (
                  <Button
                    title="Voir le numéro"
                    icon="phone"
                    variant="secondary"
                    size="sm"
                    busy={revealing === item.id}
                    onPress={() => reveal(item.id)}
                    style={{ marginTop: spacing.xs }}
                  />
                )}
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
