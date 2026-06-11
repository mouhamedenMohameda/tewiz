import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type ApplicationDto, type ApplicationStatus,
  DOCUMENT_ORDER, docsComplete, personalFieldsComplete, vehicleFieldsComplete,
} from '@/lib/kyc';

export default function BecomeCaptainHome() {
  const router = useRouter();
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
      Alert.alert('Erreur', e.response?.data?.error?.message ?? 'Impossible de charger le dossier.');
    } finally {
      setLoading(false);
    }
  }, []);

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
      Alert.alert('Erreur', e.response?.data?.error?.message ?? 'Impossible de créer le dossier.');
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
      Alert.alert('Dossier soumis', 'Votre dossier est dans la file d\'attente.');
    } catch (e: any) {
      const data = e.response?.data?.error;
      const missing = data?.details?.missing as string[] | undefined;
      Alert.alert(
        'Dossier incomplet',
        missing?.length
          ? `Il manque :\n• ${missing.join('\n• ')}`
          : (data?.message ?? 'Veuillez compléter toutes les étapes.'),
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
            <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '600' }}>‹ Retour</Text>
          </Pressable>
          <Text style={{ fontSize: 13, color: '#64748b' }}>{user?.phone}</Text>
        </View>

        <Text style={{ fontSize: 28, fontWeight: '700', color: '#0f172a', marginTop: 24 }}>
          Devenir chauffeur Tewiz
        </Text>

        {!app
          ? <NoApplication onStart={startApplication} busy={creating} />
          : (
            <View style={{ marginTop: 16 }}>
              <StatusBanner status={app.status} />

              {app.status === 'rejected' && app.rejectReason ? (
                <ErrorCard title="Raison du rejet" body={app.rejectReason} />
              ) : null}

              <StepCard
                index={1}
                title="Informations personnelles"
                subtitle="Nom, NNI, date de naissance, adresse, contact d'urgence"
                done={personalFieldsComplete(app)}
                editable={editable}
                onPress={() => router.push('/(app)/become-captain/personal')}
              />
              <StepCard
                index={2}
                title="Véhicule"
                subtitle="Plaque, marque, modèle, année, couleur, places"
                done={vehicleFieldsComplete(app)}
                editable={editable}
                onPress={() => router.push('/(app)/become-captain/vehicle')}
              />
              <StepCard
                index={3}
                title="Documents"
                subtitle={`${app.documents.length} / ${DOCUMENT_ORDER.length} photos envoyées`}
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
                    {allComplete ? 'Soumettre mon dossier' : 'Complétez toutes les étapes'}
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
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 15, color: '#475569', lineHeight: 22 }}>
        Pour conduire pour Tewiz, vous devez fournir vos informations personnelles,
        14 photos (NNI, permis, carte grise, assurance, vignette, visite technique,
        et photos du véhicule) et attendre la validation de l'équipe.
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
          Commencer le dossier
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
  const map: Record<ApplicationStatus, { bg: string; fg: string; label: string; desc: string }> = {
    draft: { bg: '#fef9c3', fg: '#854d0e', label: 'Brouillon',
      desc: 'Complétez les 3 étapes ci-dessous puis soumettez.' },
    submitted: { bg: '#dbeafe', fg: '#1e40af', label: 'Soumis',
      desc: 'Votre dossier est dans la file d\'attente.' },
    under_review: { bg: '#e0e7ff', fg: '#3730a3', label: 'En cours de revue',
      desc: 'Un admin examine votre dossier en ce moment.' },
    needs_correction: { bg: '#fef3c7', fg: '#92400e', label: 'Corrections demandées',
      desc: 'Refaites les documents marqués et soumettez à nouveau.' },
    approved: { bg: '#dcfce7', fg: '#166534', label: 'Approuvé',
      desc: 'Bienvenue chez Tewiz.' },
    rejected: { bg: '#fee2e2', fg: '#991b1b', label: 'Rejeté',
      desc: 'Votre dossier a été refusé.' },
  };
  const s = map[status];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 14, padding: 16 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
        {s.label.toUpperCase()}
      </Text>
      <Text style={{ color: s.fg, fontSize: 14, marginTop: 4, lineHeight: 20 }}>
        {s.desc}
      </Text>
    </View>
  );
}
