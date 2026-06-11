import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Linking, Pressable,
  RefreshControl, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';

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
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Favorite[]>('/rider/favorites');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(captainId: string, name: string) {
    Alert.alert(
      'Retirer ce chauffeur ?',
      `${name} ne sera plus prioritaire pour vos prochaines courses.`,
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Retirer', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/rider/favorites/${captainId}`);
              await load();
            } catch (e: any) {
              Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={{ padding: 20 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a', marginTop: 8 }}>
          Mes chauffeurs
        </Text>
        <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 18 }}>
          Vos favoris sont proposés en premier (pendant 30 s) avant de basculer
          sur les autres chauffeurs.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.captainId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={{
              backgroundColor: '#fff', borderRadius: 14, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '600' }}>
                Aucun favori pour le moment
              </Text>
              <Text style={{ color: '#64748b', fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                Après une course 5 étoiles, vous pourrez ajouter le chauffeur ici.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const name = item.nickname ?? item.captainName ?? 'Chauffeur';
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 22, backgroundColor: '#fef3c7',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 22 }}>⭐</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
                    {name}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    ⭐ {item.ratingAvg > 0 ? item.ratingAvg.toFixed(1) : '—'} · {item.totalRides} courses
                  </Text>
                </View>
                <Pressable
                  onPress={() => Linking.openURL(`tel:${item.captainPhone}`)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? '#0a7a45' : '#10a35e',
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  })}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>📞</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => remove(item.captainId, name)}
                style={({ pressed }) => ({
                  marginTop: 12, paddingTop: 10,
                  borderTopWidth: 1, borderTopColor: '#f1f5f9',
                  alignItems: 'center',
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text style={{ color: '#dc2626', fontSize: 13, fontWeight: '600' }}>
                  Retirer des favoris
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
