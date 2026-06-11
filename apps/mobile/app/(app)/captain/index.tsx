import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, Switch, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import { ModeToggle } from '@/components/ModeToggle';
import { resetRideAlerts } from '@/components/CaptainRideWatcher';

type Presence = 'offline' | 'online' | 'on_ride';

interface WalletSummary {
  balanceKhoums: number;
  updatedAt: string;
}

interface StateRow {
  presence: Presence;
  updated_at: string;
  lat: number | null;
  lng: number | null;
}

interface GoingHomeSession {
  id: string;
  startedAt: string;
  expiresAt: string;
}

export default function CaptainHome() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [state, setState] = useState<StateRow | null>(null);
  const [goingHome, setGoingHome] = useState<GoingHomeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [togglingGoingHome, setTogglingGoingHome] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, stateRes, ghRes] = await Promise.allSettled([
        api.get<WalletSummary>('/captain/wallet'),
        api.get<StateRow>('/captain/state'),
        api.get<GoingHomeSession>('/captain/state/going-home'),
      ]);
      if (walletRes.status === 'fulfilled') setWallet(walletRes.value.data);
      if (stateRes.status === 'fulfilled') {
        setState(stateRes.value.data);
      } else {
        // 404 = no state row yet → captain has never been online.
        setState({ presence: 'offline', updated_at: '', lat: null, lng: null });
      }
      if (ghRes.status === 'fulfilled' && ghRes.value.status !== 204) {
        setGoingHome(ghRes.value.data);
      } else {
        setGoingHome(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh balance/state/going-home periodically (battery-friendly cadence).
  usePolling(load, 30_000);

  async function goOnline() {
    setToggling(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Position requise',
          'Tewiz a besoin de votre position pour vous mettre en ligne.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.post('/captain/state/online', {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      await load();
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur lors du passage en ligne.');
    } finally {
      setToggling(false);
    }
  }

  async function goOffline() {
    setToggling(true);
    try {
      await api.post('/captain/state/offline', {});
      await load();
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur lors du passage hors ligne.');
    } finally {
      setToggling(false);
    }
  }

  async function toggleGoingHome(next: boolean) {
    setTogglingGoingHome(true);
    try {
      if (next) {
        const r = await api.post<GoingHomeSession>('/captain/state/going-home', {});
        setGoingHome(r.data);
      } else {
        await api.delete('/captain/state/going-home');
        setGoingHome(null);
      }
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur sur le mode "Je rentre chez moi".');
    } finally {
      setTogglingGoingHome(false);
    }
  }

  async function logout() {
    await clear();
    router.replace('/(auth)');
  }

  const presence: Presence = state?.presence ?? 'offline';
  const online = presence === 'online' || presence === 'on_ride';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 13, color: '#64748b' }}>Connecté</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#0f172a' }}>
              {user?.fullName ?? user?.phone}
            </Text>
          </View>
          <Pressable onPress={logout}>
            <Text style={{ color: '#dc2626', fontSize: 14, fontWeight: '600' }}>Déconnexion</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 16, alignItems: 'flex-start' }}>
          <ModeToggle />
        </View>

        {/* Online state card */}
        <View style={{
          marginTop: 24, backgroundColor: online ? '#10a35e' : '#fff',
          borderRadius: 16, padding: 20,
        }}>
          <Text style={{ fontSize: 13, color: online ? '#dcfce7' : '#64748b' }}>
            État
          </Text>
          <Text style={{
            fontSize: 28, fontWeight: '700', marginTop: 2,
            color: online ? '#fff' : '#0f172a',
          }}>
            {presence === 'on_ride' ? 'En course' : online ? 'En ligne' : 'Hors ligne'}
          </Text>

          <Pressable
            disabled={toggling || presence === 'on_ride'}
            onPress={online ? goOffline : goOnline}
            style={({ pressed }) => ({
              marginTop: 16, paddingVertical: 14, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: online
                ? (pressed ? '#0a7a45' : '#0f7c4a')
                : (pressed ? '#0f7c4a' : '#0f172a'),
              opacity: toggling || presence === 'on_ride' ? 0.5 : 1,
            })}
          >
            {toggling && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              {online ? 'Passer hors ligne' : 'Passer en ligne'}
            </Text>
          </Pressable>
        </View>

        {/* Wallet */}
        <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
          <Text style={{ fontSize: 13, color: '#64748b' }}>Solde</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#0f172a', marginTop: 2 }}>
            {wallet ? formatMru(wallet.balanceKhoums) : '—'}
          </Text>
          <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Recharger via Bankily/Masrivi puis envoyer la capture à un admin.
          </Text>
        </View>

        {/* Going-home */}
        <View style={{
          marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>
              Je rentre chez moi
            </Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 18 }}>
              Priorité aux courses qui vous rapprochent de votre domicile.
            </Text>
            {goingHome ? (
              <Text style={{ fontSize: 11, color: '#0f7c4a', marginTop: 4 }}>
                Actif jusqu'à {new Date(goingHome.expiresAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            ) : null}
          </View>
          {togglingGoingHome ? (
            <ActivityIndicator />
          ) : (
            <Switch
              value={!!goingHome}
              onValueChange={toggleGoingHome}
              disabled={!online}
            />
          )}
        </View>

        {/* Navigation */}
        <View style={{ marginTop: 24, gap: 10 }}>
          <NavCard icon="🛣️" title="Courses" subtitle="Inbox des courses et course en cours"
            onPress={() => router.push('/(app)/captain/rides')} />
          <NavCard icon="💰" title="Wallet" subtitle="Solde, recharge et mouvements"
            onPress={() => router.push('/(app)/captain/wallet')} />
          <NavCard icon="🏠" title="Mon domicile" subtitle={'Pour le mode "Je rentre chez moi"'}
            onPress={() => router.push('/(app)/captain/home-location')} />
          <NavCard icon="📊" title="Zones chaudes" subtitle="Où se trouve la demande maintenant"
            onPress={() => router.push('/(app)/captain/heatmap')} />
          <NavCard icon="📅" title="Courses récurrentes" subtitle="Engagements hebdomadaires"
            onPress={() => router.push('/(app)/captain/recurring')} />
        </View>

        <Pressable
          onPress={() => {
            Alert.alert(
              'Réinitialiser les alertes ?',
              'Vide la liste des courses déjà vues et lève toute pause. À utiliser si vous ne recevez plus de notifications alors que vous êtes en ligne.',
              [
                { text: 'Non', style: 'cancel' },
                {
                  text: 'Réinitialiser',
                  onPress: async () => {
                    await resetRideAlerts();
                    Alert.alert('Fait', 'Les alertes vont reprendre à la prochaine course.');
                  },
                },
              ],
            );
          }}
          style={({ pressed }) => ({
            marginTop: 24, padding: 12, alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '600' }}>
            🔄 Réinitialiser les alertes
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function NavCard({
  icon, title, subtitle, onPress,
}: {
  icon: string; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#f1f5f9' : '#fff',
        borderRadius: 14, padding: 16,
        flexDirection: 'row', alignItems: 'center', gap: 14,
      })}
    >
      <Text style={{ fontSize: 26 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{title}</Text>
        <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: '#94a3b8', fontSize: 20 }}>›</Text>
    </Pressable>
  );
}
