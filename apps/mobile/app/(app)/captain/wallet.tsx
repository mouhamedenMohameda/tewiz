import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';

type Provider = 'bankily' | 'masrivi' | 'sedad' | 'cash_office';
type TopupStatus = 'pending' | 'approved' | 'partial' | 'rejected' | 'duplicate';
type TxType = 'topup' | 'commission' | 'commission_refund' | 'manual_adjustment' | 'bonus';

interface WalletSummary {
  balanceKhoums: number;
  updatedAt: string;
  transactions: Tx[];
}
interface Tx {
  id: string;
  type: TxType;
  amountKhoums: number;
  balanceAfter: number;
  rideId: string | null;
  reason: string | null;
  createdAt: string;
}
interface Topup {
  id: string;
  provider: Provider;
  referenceCode: string;
  claimedAmountKhoums: number;
  providerRefNumber: string | null;
  status: TopupStatus;
  approvedAmountKhoums: number | null;
  rejectReason: string | null;
  createdAt: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  bankily: 'Bankily',
  masrivi: 'Masrivi',
  sedad: 'Sedad',
  cash_office: 'Bureau Tewiz',
};

export default function WalletScreen() {
  const router = useRouter();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [loading, setLoading] = useState(true);
  const [topupModal, setTopupModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, t] = await Promise.all([
        api.get<WalletSummary>('/captain/wallet'),
        api.get<Topup[]>('/captain/wallet/topups'),
      ]);
      setSummary(w.data);
      setTopups(t.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>

        <View style={{
          marginTop: 16, backgroundColor: '#10a35e', borderRadius: 16, padding: 20,
        }}>
          <Text style={{ fontSize: 13, color: '#dcfce7' }}>Solde wallet</Text>
          <Text style={{ fontSize: 34, fontWeight: '700', color: '#fff', marginTop: 4 }}>
            {summary ? formatMru(summary.balanceKhoums) : '—'}
          </Text>
          <Text style={{ fontSize: 12, color: '#bbf7d0', marginTop: 6 }}>
            La commission 7% (10% colis) est débitée à la fin de chaque course.
          </Text>
        </View>

        <Pressable
          onPress={() => setTopupModal(true)}
          style={({ pressed }) => ({
            marginTop: 16, padding: 14, borderRadius: 12,
            backgroundColor: pressed ? '#0a1e6f' : '#0f172a',
            alignItems: 'center',
          })}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            Envoyer une capture de recharge
          </Text>
        </Pressable>

        <SectionTitle>Recharges</SectionTitle>
        {topups.length === 0 ? (
          <EmptyHint text="Aucune recharge envoyée." />
        ) : (
          topups.map((t) => <TopupRow key={t.id} t={t} />)
        )}

        <SectionTitle>Mouvements récents</SectionTitle>
        {(summary?.transactions ?? []).length === 0 ? (
          <EmptyHint text="Aucun mouvement." />
        ) : (
          summary!.transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)
        )}
      </ScrollView>

      <TopupModal
        visible={topupModal}
        onClose={() => setTopupModal(false)}
        onCreated={async () => { setTopupModal(false); await load(); }}
      />
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={{ marginTop: 24, fontSize: 13, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>
      {children.toUpperCase()}
    </Text>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Text style={{ marginTop: 12, fontSize: 13, color: '#94a3b8' }}>{text}</Text>
  );
}

function TopupRow({ t }: { t: Topup }) {
  const statusColor: Record<TopupStatus, string> = {
    pending: '#92400e',
    approved: '#15803d',
    partial: '#854d0e',
    rejected: '#b91c1c',
    duplicate: '#475569',
  };
  const statusBg: Record<TopupStatus, string> = {
    pending: '#fef3c7',
    approved: '#dcfce7',
    partial: '#fef9c3',
    rejected: '#fee2e2',
    duplicate: '#e2e8f0',
  };
  return (
    <View style={{
      marginTop: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a' }}>
          {PROVIDER_LABELS[t.provider]} · {formatMru(t.claimedAmountKhoums)}
        </Text>
        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          Réf #{t.referenceCode} · {new Date(t.createdAt).toLocaleDateString('fr-FR')}
        </Text>
        {t.rejectReason ? (
          <Text style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>{t.rejectReason}</Text>
        ) : null}
      </View>
      <View style={{
        backgroundColor: statusBg[t.status], paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
      }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: statusColor[t.status] }}>
          {t.status.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const positive = tx.amountKhoums >= 0;
  const labels: Record<TxType, string> = {
    topup: 'Recharge',
    commission: 'Commission',
    commission_refund: 'Remboursement',
    manual_adjustment: 'Ajustement',
    bonus: 'Bonus',
  };
  return (
    <View style={{
      marginTop: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12,
      flexDirection: 'row', justifyContent: 'space-between',
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a' }}>
          {labels[tx.type]}
        </Text>
        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {new Date(tx.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
          {tx.reason ? ` · ${tx.reason}` : ''}
        </Text>
      </View>
      <Text style={{
        fontSize: 14, fontWeight: '700',
        color: positive ? '#15803d' : '#b91c1c',
      }}>
        {positive ? '+' : ''}{formatMru(tx.amountKhoums)}
      </Text>
    </View>
  );
}

function TopupModal({
  visible, onClose, onCreated,
}: {
  visible: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('bankily');
  const [amountMru, setAmountMru] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setProvider('bankily');
    setAmountMru('');
    setRefNumber('');
    setPhotoUri(null);
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission requise', 'Accordez l\'accès à la galerie.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!r.canceled && r.assets[0]) setPhotoUri(r.assets[0].uri);
  }

  async function submit() {
    const mruNum = Number(amountMru);
    if (!mruNum || mruNum < 1) {
      Alert.alert('Montant invalide', 'Entrez un montant en MRU.');
      return;
    }
    if (!photoUri) {
      Alert.alert('Capture requise', 'Joignez la capture d\'écran de votre paiement.');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('file', {
        uri: photoUri,
        name: 'topup.jpg',
        type: 'image/jpeg',
      } as any);
      form.append('provider', provider);
      form.append('claimedAmountKhoums', String(Math.round(mruNum * 5)));
      if (refNumber.trim()) form.append('providerRefNumber', refNumber.trim());

      await api.post('/captain/wallet/topups', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      reset();
      onCreated();
    } catch (e: any) {
      Alert.alert('Échec', e.response?.data?.error?.message ?? 'Impossible d\'envoyer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
              Nouvelle recharge
            </Text>
            <Pressable onPress={onClose}><Text style={{ color: '#64748b', fontSize: 15 }}>Fermer</Text></Pressable>
          </View>

          <Text style={{ marginTop: 16, fontSize: 13, color: '#64748b', lineHeight: 18 }}>
            Effectuez le virement sur le numéro Tewiz, puis joignez la capture pour validation.
          </Text>

          <Text style={{ marginTop: 20, fontSize: 13, fontWeight: '600', color: '#475569' }}>
            Fournisseur
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setProvider(p)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
                  backgroundColor: provider === p ? '#0f172a' : (pressed ? '#e2e8f0' : '#fff'),
                  borderWidth: 1, borderColor: provider === p ? '#0f172a' : '#e2e8f0',
                })}
              >
                <Text style={{
                  color: provider === p ? '#fff' : '#0f172a',
                  fontSize: 13, fontWeight: '600',
                }}>{PROVIDER_LABELS[p]}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ marginTop: 20, fontSize: 13, fontWeight: '600', color: '#475569' }}>
            Montant (MRU)
          </Text>
          <TextInput
            value={amountMru}
            onChangeText={(t) => setAmountMru(t.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="1000"
            placeholderTextColor="#94a3b8"
            style={{
              marginTop: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
              paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff',
            }}
          />

          <Text style={{ marginTop: 20, fontSize: 13, fontWeight: '600', color: '#475569' }}>
            N° de référence (facultatif)
          </Text>
          <TextInput
            value={refNumber}
            onChangeText={setRefNumber}
            placeholder="TXN123456"
            placeholderTextColor="#94a3b8"
            style={{
              marginTop: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
              paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff',
            }}
          />

          <Pressable
            onPress={pickPhoto}
            style={({ pressed }) => ({
              marginTop: 20, padding: 16, borderRadius: 12,
              borderWidth: 1, borderColor: '#cbd5e1', borderStyle: 'dashed',
              backgroundColor: pressed ? '#f1f5f9' : '#fff', alignItems: 'center',
            })}
          >
            <Text style={{ color: photoUri ? '#15803d' : '#475569', fontSize: 14, fontWeight: '600' }}>
              {photoUri ? '✓ Capture jointe — toucher pour remplacer' : 'Joindre la capture d\'écran'}
            </Text>
          </Pressable>

          <Pressable
            disabled={submitting}
            onPress={submit}
            style={({ pressed }) => ({
              marginTop: 24, backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
              opacity: submitting ? 0.5 : 1,
              paddingVertical: 16, borderRadius: 12, alignItems: 'center',
              flexDirection: 'row', justifyContent: 'center', gap: 8,
            })}
          >
            {submitting && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Envoyer pour validation
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
