import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import {
  AppText, Button, Card, Icon, Screen, ScreenHeader, TextField,
} from '@/components/ui';
import { colors, gradients, radius, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

type Provider = 'bankily' | 'masrivi' | 'sedad' | 'cash_office';
type TopupStatus = 'pending' | 'approved' | 'partial' | 'rejected' | 'duplicate';
type TxType = 'topup' | 'commission' | 'commission_refund' | 'manual_adjustment' | 'bonus';

interface WalletSummary {
  balanceMru: number;
  updatedAt: string;
  transactions: Tx[];
}
interface Tx {
  id: string;
  type: TxType;
  amountMru: number;
  balanceAfter: number;
  rideId: string | null;
  reason: string | null;
  createdAt: string;
}
interface Topup {
  id: string;
  provider: Provider;
  referenceCode: string;
  claimedAmountMru: number;
  providerRefNumber: string | null;
  status: TopupStatus;
  approvedAmountMru: number | null;
  rejectReason: string | null;
  createdAt: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  bankily: 'Bankily',
  masrivi: 'Masrivi',
  sedad: 'Sedad',
  cash_office: `Bureau ${APP_NAME}`,
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
    <Screen scroll onRefresh={load} refreshing={loading}>
      <ScreenHeader title="Portefeuille" onBack={() => router.back()} />

      {/* Balance hero */}
      <LinearGradient
        colors={gradients.ember}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xxl, padding: spacing.xl }}
      >
        <AppText variant="overline" color="#FFF1DD">Solde wallet</AppText>
        <AppText variant="hero" color={colors.white} style={{ marginTop: spacing.xs, fontSize: 36 }}>
          {summary ? formatMru(summary.balanceMru) : '—'}
        </AppText>
        <AppText variant="caption" color="#FFF1DD" style={{ marginTop: spacing.sm, opacity: 0.95 }}>
          La commission 7 % (10 % colis) est débitée à la fin de chaque course.
        </AppText>
      </LinearGradient>

      <Button
        title="Envoyer une capture de recharge"
        variant="dark"
        icon="document"
        onPress={() => setTopupModal(true)}
        style={{ marginTop: spacing.base }}
      />

      <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
        Recharges
      </AppText>
      {topups.length === 0 ? (
        <EmptyHint text="Aucune recharge envoyée." />
      ) : (
        <View style={{ gap: spacing.sm }}>{topups.map((t) => <TopupRow key={t.id} t={t} />)}</View>
      )}

      <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
        Mouvements récents
      </AppText>
      {(summary?.transactions ?? []).length === 0 ? (
        <EmptyHint text="Aucun mouvement." />
      ) : (
        <View style={{ gap: spacing.sm }}>{summary!.transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)}</View>
      )}

      <TopupModal
        visible={topupModal}
        onClose={() => setTopupModal(false)}
        onCreated={async () => { setTopupModal(false); await load(); }}
      />
    </Screen>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.xs }}>{text}</AppText>;
}

const PILL: Record<TopupStatus, { bg: string; fg: string }> = {
  pending:   { bg: colors.saffronSoft, fg: '#9A6711' },
  approved:  { bg: colors.successSoft, fg: colors.success },
  partial:   { bg: '#FBEFCB', fg: '#9A6711' },
  rejected:  { bg: colors.dangerSoft, fg: colors.danger },
  duplicate: { bg: colors.surfaceAlt, fg: colors.muted },
};

function TopupRow({ t }: { t: Topup }) {
  const pill = PILL[t.status];
  return (
    <Card padding={spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">
          {PROVIDER_LABELS[t.provider]} · {formatMru(t.claimedAmountMru)}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          Réf #{t.referenceCode} · {new Date(t.createdAt).toLocaleDateString('fr-FR')}
        </AppText>
        {t.rejectReason ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: 2 }}>{t.rejectReason}</AppText>
        ) : null}
      </View>
      <View style={{ backgroundColor: pill.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm }}>
        <AppText variant="overline" color={pill.fg} style={{ letterSpacing: 0.6 }}>{t.status}</AppText>
      </View>
    </Card>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const positive = tx.amountMru >= 0;
  const labels: Record<TxType, string> = {
    topup: 'Recharge',
    commission: 'Commission',
    commission_refund: 'Remboursement',
    manual_adjustment: 'Ajustement',
    bonus: 'Bonus',
  };
  return (
    <Card padding={spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{labels[tx.type]}</AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          {new Date(tx.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
          {tx.reason ? ` · ${tx.reason}` : ''}
        </AppText>
      </View>
      <AppText variant="title" color={positive ? colors.success : colors.danger}>
        {positive ? '+' : ''}{formatMru(tx.amountMru)}
      </AppText>
    </Card>
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
      // Send MRU as-is. No more khoums conversion (migration 0017).
      form.append('claimedAmountMru', String(Math.round(mruNum)));
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}>
          <ScreenHeader
            title="Nouvelle recharge"
            right={
              <Pressable onPress={onClose} hitSlop={10}>
                <Icon name="close" size={26} color={colors.ink2} />
              </Pressable>
            }
          />

          <AppText variant="body" color={colors.ink2}>
            Effectuez le virement sur le numéro {APP_NAME}, puis joignez la capture pour validation.
          </AppText>

          <AppText variant="label" color={colors.ink2} style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            Fournisseur
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => {
              const active = provider === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setProvider(p)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill,
                    backgroundColor: active ? colors.ember : colors.surface,
                    borderWidth: 1.5, borderColor: active ? colors.ember : colors.line,
                  }}
                >
                  <AppText variant="label" color={active ? colors.onEmber : colors.ink}>
                    {PROVIDER_LABELS[p]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <TextField
            containerStyle={{ marginTop: spacing.xl }}
            label="Montant (MRU)"
            icon="cash"
            value={amountMru}
            onChangeText={(t) => setAmountMru(t.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="1000"
          />

          <TextField
            containerStyle={{ marginTop: spacing.base }}
            label="N° de référence (facultatif)"
            value={refNumber}
            onChangeText={setRefNumber}
            placeholder="TXN123456"
            autoCapitalize="characters"
          />

          <Pressable
            onPress={pickPhoto}
            style={({ pressed }) => ({
              marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.lg,
              borderWidth: 1.5, borderColor: photoUri ? colors.success : colors.lineStrong, borderStyle: 'dashed',
              backgroundColor: photoUri ? colors.successSoft : (pressed ? colors.surfaceAlt : colors.surface),
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
            })}
          >
            <Icon name={photoUri ? 'check' : 'document'} size={20} color={photoUri ? colors.success : colors.ink2} />
            <AppText variant="bodyStrong" color={photoUri ? colors.success : colors.ink2}>
              {photoUri ? 'Capture jointe — toucher pour remplacer' : 'Joindre la capture d\'écran'}
            </AppText>
          </Pressable>

          <Button
            title="Envoyer pour validation"
            iconRight="send"
            busy={submitting}
            onPress={submit}
            style={{ marginTop: spacing.xl }}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
