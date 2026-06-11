import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ModeToggle } from '@/components/ModeToggle';
import type { ApplicationDto, ApplicationStatus } from '@/lib/kyc';

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress' | 'completed';

interface CurrentRide {
  id: string;
  status: RideStatus;
  pickup: { label: string | null };
  dropoff: { label: string | null };
}

const STATUS_LABEL: Record<RideStatus, string> = {
  pending_passenger_confirm: 'En attente de confirmation',
  searching: 'Recherche d\'un chauffeur',
  accepted:  'Chauffeur en route',
  arrived:   'Chauffeur arrivé',
  in_progress: 'Course en cours',
  completed: 'Noter votre course',
};

export default function RiderHome() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);

  const [application, setApplication] = useState<ApplicationDto | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [current, setCurrent] = useState<CurrentRide | null>(null);

  const loadApp = useCallback(async () => {
    // Captains don't need to see the "become captain" CTA.
    if (user?.role === 'captain') {
      setApplication(null);
      setLoadingApp(false);
    } else {
      try {
        const r = await api.get<ApplicationDto | null>('/captain/applications/me');
        setApplication(r.data);
      } catch {
        setApplication(null);
      } finally {
        setLoadingApp(false);
      }
    }
    // Always check for an active ride so the "course en cours" banner shows.
    try {
      const r = await api.get<CurrentRide>('/rider/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      setCurrent(r.status === 200 ? r.data : null);
    } catch {
      setCurrent(null);
    }
  }, [user?.role]);

  useEffect(() => { loadApp(); }, [loadApp]);
  useFocusEffect(useCallback(() => { loadApp(); }, [loadApp]));

  async function logout() {
    await clear();
    router.replace('/(auth)');
  }

  function requestRide() {
    router.push('/(app)/rider/new-ride');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={loadApp} />}
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

        {current ? (
          <Pressable
            onPress={() => router.push('/(app)/rider/current')}
            style={({ pressed }) => ({
              marginTop: 16, backgroundColor: pressed ? '#dcfce7' : '#ecfdf5',
              borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#a7f3d0',
              flexDirection: 'row', alignItems: 'center', gap: 12,
            })}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 18, backgroundColor: '#10a35e',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: '#fff', fontSize: 18 }}>🚖</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#065f46', letterSpacing: 0.5 }}>
                COURSE EN COURS
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a', marginTop: 2 }}>
                {STATUS_LABEL[current.status] ?? current.status}
              </Text>
            </View>
            <Text style={{ color: '#10a35e', fontSize: 20 }}>›</Text>
          </Pressable>
        ) : null}

        {/* Hero: request a ride */}
        <View style={{
          marginTop: current ? 16 : 24, backgroundColor: '#0f172a',
          borderRadius: 18, padding: 22,
        }}>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Où allez-vous ?</Text>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 4 }}>
            Commander une course
          </Text>
          <Pressable
            onPress={requestRide}
            disabled={!!current}
            style={({ pressed }) => ({
              marginTop: 16, backgroundColor: pressed ? '#0a9050' : '#10a35e',
              opacity: current ? 0.5 : 1,
              paddingVertical: 14, borderRadius: 12, alignItems: 'center',
            })}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              {current ? 'Une course est déjà en cours' : 'Choisir la destination'}
            </Text>
          </Pressable>
        </View>

        {/* Navigation */}
        <View style={{ marginTop: 24, gap: 10 }}>
          <NavCard icon="🧾" title="Mes courses" subtitle="Historique et course en cours"
            onPress={() => router.push('/(app)/rider/history')} />
          <NavCard icon="👨‍👩‍👧" title="Mes chauffeurs" subtitle="Vos favoris seront proposés en premier"
            onPress={() => router.push('/(app)/rider/favorites')} />
          <NavCard icon="📅" title="Courses récurrentes" subtitle="Trajets hebdomadaires"
            onPress={() => router.push('/(app)/rider/recurring')} />
        </View>

        {/* Become a captain — riders only */}
        {user?.role === 'rider' ? (
          <View style={{ marginTop: 28 }}>
            <BecomeCaptainCard
              loading={loadingApp}
              application={application}
              onPress={() => router.push('/(app)/become-captain')}
            />
          </View>
        ) : null}
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

function BecomeCaptainCard({
  loading, application, onPress,
}: {
  loading: boolean; application: ApplicationDto | null; onPress: () => void;
}) {
  if (loading) {
    return (
      <View style={{ alignItems: 'center', padding: 16 }}>
        <ActivityIndicator />
      </View>
    );
  }

  const status: ApplicationStatus | null = application?.status ?? null;
  const { title, subtitle, cta } = describe(status);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#fde68a' : '#fef3c7',
        borderRadius: 16, padding: 18, gap: 10,
        borderWidth: 1, borderColor: '#fcd34d',
      })}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e', letterSpacing: 0.5 }}>
        DEVENIR CHAUFFEUR
      </Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#7c2d12' }}>{title}</Text>
      <Text style={{ fontSize: 13, color: '#7c2d12', lineHeight: 18 }}>{subtitle}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#7c2d12', marginTop: 4 }}>
        {cta} ›
      </Text>
    </Pressable>
  );
}

function describe(status: ApplicationStatus | null): { title: string; subtitle: string; cta: string } {
  switch (status) {
    case null: return {
      title: 'Conduisez avec Tewiz',
      subtitle: 'Soumettez votre dossier (papiers + photos du véhicule) et commencez à gagner.',
      cta: 'Commencer mon dossier',
    };
    case 'draft': return {
      title: 'Dossier en cours',
      subtitle: 'Continuez là où vous vous êtes arrêté.',
      cta: 'Reprendre',
    };
    case 'needs_correction': return {
      title: 'Corrections demandées',
      subtitle: 'Un admin a demandé des changements sur votre dossier.',
      cta: 'Voir les corrections',
    };
    case 'submitted':
    case 'under_review': return {
      title: 'Dossier en cours d\'examen',
      subtitle: 'Vous serez notifié dès qu\'il est validé.',
      cta: 'Voir l\'état',
    };
    case 'rejected': return {
      title: 'Dossier refusé',
      subtitle: 'Consultez le motif puis soumettez à nouveau si possible.',
      cta: 'Voir le motif',
    };
    case 'approved': return {
      title: 'Bienvenue chauffeur',
      subtitle: 'Vous pouvez passer en mode chauffeur dès maintenant.',
      cta: 'Aller au mode chauffeur',
    };
  }
}
