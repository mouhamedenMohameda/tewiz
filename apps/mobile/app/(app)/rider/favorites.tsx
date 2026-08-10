import {
  ActivityIndicator, Alert, FlatList, Pressable,
  RefreshControl, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlainText as Text, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { colors, radius, statusTone } from '@/theme';

interface Favorite {
  captainId: string;
  nickname: string | null;
  captainName: string | null;
  captainPhone: string;
  ratingAvg: number;
  totalRides: number;
  addedAt: string;
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    data: items = [], isLoading, isFetching, refetch,
  } = useApiQuery<Favorite[]>(['rider', 'favorites'], '/rider/favorites');

  async function remove(captainId: string, name: string) {
    Alert.alert(
      t('rider.favorites.removeTitle'),
      t('rider.favorites.removeBody', { name }),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('rider.favorites.remove'), style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/rider/favorites/${captainId}`);
              await refetch();
            } catch (e: any) {
              Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: 20 }}>
        <ScreenHeader title={t('rider.favorites.title')} onBack={() => router.back()} />
        <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 4, lineHeight: 18 }}>
          {t('rider.favorites.intro')}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.captainId}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={{
              backgroundColor: colors.surface, borderRadius: radius.md, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>
                {t('rider.favorites.emptyTitle')}
              </Text>
              <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {t('rider.favorites.emptyBody')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const name = item.nickname ?? item.captainName ?? t('rider.favorites.fallbackName');
          const ratingDisplay = item.ratingAvg > 0
            ? item.ratingAvg.toFixed(1)
            : t('rider.favorites.noRating');
          return (
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22, backgroundColor: statusTone.pending.bg,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 22 }}>⭐</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                    {name}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.ink2, marginTop: 2 }}>
                    ⭐ {t('rider.favorites.ratingCount', { rating: ratingDisplay, count: item.totalRides })}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => remove(item.captainId, name)}
                style={({ pressed }) => ({
                  marginTop: 12, paddingTop: 10,
                  borderTopWidth: 1, borderTopColor: colors.line,
                  alignItems: 'center',
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
                  {t('rider.favorites.removeAction')}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
