import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import {
  AppText, Button, Card, Icon, Screen, ScreenHeader, TextField,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';
import { wrapRow } from '@/components/ui';

type Provider = 'bankily' | 'masrvi' | 'sedad' | 'cash_office';
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
  masrvi: 'Masrvi',
  sedad: 'Sedad',
  cash_office: `Bureau ${APP_NAME}`,
};

const PROVIDER_LOGOS: Record<Provider, any> = {
  bankily: require('@/assets/banks/bankily.png'),
  masrvi: require('@/assets/banks/masrvi.png'),
  sedad: require('@/assets/banks/sedad.jpeg'),
  cash_office: require('@/assets/icon.png'),
};

// Numéros officiels où le chauffeur doit envoyer la recharge. Affichés
// dans la modale dès qu'il sélectionne le fournisseur correspondant.
const PROVIDER_PHONES: Partial<Record<Provider, string>> = {
  bankily: '42986738',
  sedad: '32164356',
  masrvi: '36863516',
};

export default function WalletScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
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
      <ScreenHeader title={t('captain.wallet.title')} onBack={() => router.back()} />

      {/* Balance hero */}
      <LinearGradient
        colors={gradients.ember}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xxl, padding: spacing.xl }}
      >
        <AppText variant="overline" color="#FFF1DD">{t('captain.wallet.balance')}</AppText>
        <AppText variant="hero" color={colors.white} style={{ marginTop: spacing.xs, fontSize: 36 }}>
          {summary ? formatMru(summary.balanceMru) : '—'}
        </AppText>
        <AppText variant="caption" color="#FFF1DD" style={{ marginTop: spacing.sm, opacity: 0.95 }}>
          {t('captain.wallet.commissionNote')}
        </AppText>
      </LinearGradient>

      <Button
        title={t('captain.wallet.uploadReceipt')}
        variant="dark"
        icon="document"
        onPress={() => setTopupModal(true)}
        style={{ marginTop: spacing.base }}
      />

      <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
        {t('captain.wallet.topups')}
      </AppText>
      {topups.length === 0 ? (
        <EmptyHint text={t('captain.wallet.noTopups')} />
      ) : (
        <View style={{ gap: spacing.sm }}>{topups.map((it) => <TopupRow key={it.id} t={it} locale={i18n.language} />)}</View>
      )}

      <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
        {t('captain.wallet.recent')}
      </AppText>
      {(summary?.transactions ?? []).length === 0 ? (
        <EmptyHint text={t('captain.wallet.noTx')} />
      ) : (
        <View style={{ gap: spacing.sm }}>{summary!.transactions.map((tx) => <TxRow key={tx.id} tx={tx} locale={i18n.language} />)}</View>
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

function TopupRow({ t: tx, locale }: { t: Topup; locale: string }) {
  const { t } = useTranslation();
  const pill = PILL[tx.status];
  return (
    <Card padding={spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">
          {PROVIDER_LABELS[tx.provider]} · {formatMru(tx.claimedAmountMru)}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          {t('captain.wallet.ref', { code: tx.referenceCode })} · {new Date(tx.createdAt).toLocaleDateString(locale)}
        </AppText>
        {tx.rejectReason ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: 2 }}>{tx.rejectReason}</AppText>
        ) : null}
      </View>
      <View style={{ backgroundColor: pill.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm }}>
        <AppText variant="overline" color={pill.fg} style={{ letterSpacing: 0.6 }}>
          {t(`captain.wallet.topupStatus.${tx.status}` as const)}
        </AppText>
      </View>
    </Card>
  );
}

function ProviderPhonePanel({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const phone = PROVIDER_PHONES[provider];
  if (!phone) return null;
  async function copy() {
    await Clipboard.setStringAsync(phone!);
    Alert.alert(t('captain.wallet.topupModal.phoneCopiedTitle'), t('captain.wallet.topupModal.phoneCopiedBody', { phone }));
  }
  return (
    <View style={{
      marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line,
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    }}>
      <View style={{ flex: 1 }}>
        <AppText variant="overline" color={colors.muted}>
          {t('captain.wallet.topupModal.sendTo', { provider: PROVIDER_LABELS[provider] })}
        </AppText>
        <AppText variant="h2" style={{ marginTop: 2, letterSpacing: 1.5 }}>
          {phone}
        </AppText>
      </View>
      <Pressable
        onPress={copy}
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill,
          backgroundColor: pressed ? colors.emberDeep : colors.ember,
        })}
      >
        <Icon name="document" size={14} color={colors.onEmber} />
        <AppText variant="label" color={colors.onEmber}>
          {t('captain.wallet.topupModal.copy')}
        </AppText>
      </Pressable>
    </View>
  );
}

function TxRow({ tx, locale }: { tx: Tx; locale: string }) {
  const { t } = useTranslation();
  const positive = tx.amountMru >= 0;
  return (
    <Card padding={spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{t(`captain.wallet.txTypes.${tx.type}` as const)}</AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
          {new Date(tx.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
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
  const { t } = useTranslation();
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
      Alert.alert(t('common.permissionRequired'), t('captain.wallet.topupModal.galleryPermission'));
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
      Alert.alert(t('captain.wallet.topupModal.invalidAmountTitle'), t('captain.wallet.topupModal.invalidAmountBody'));
      return;
    }
    if (!photoUri) {
      Alert.alert(t('captain.wallet.topupModal.missingPhotoTitle'), t('captain.wallet.topupModal.missingPhotoBody'));
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
      Alert.alert(t('captain.wallet.topupModal.failTitle'), e.response?.data?.error?.message ?? t('captain.wallet.topupModal.failBody'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}>
          <ScreenHeader
            title={t('captain.wallet.topupModal.title')}
            right={
              <Pressable
                onPress={onClose}
                hitSlop={20}
                style={{
                  width: 44, height: 44, borderRadius: radius.pill,
                  backgroundColor: colors.surface,
                  alignItems: 'center', justifyContent: 'center',
                  ...shadow.card,
                }}
              >
                <Icon name="close" size={22} color={colors.ink2} />
              </Pressable>
            }
          />

          <AppText variant="body" color={colors.ink2}>
            {t('captain.wallet.topupModal.intro', { app: APP_NAME })}
          </AppText>

          <AppText variant="label" color={colors.ink2} style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            {t('captain.wallet.topupModal.providerLabel')}
          </AppText>
          <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.md }}>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => {
              const active = provider === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setProvider(p)}
                  style={{
                    flex: 1, minWidth: '45%', paddingHorizontal: 12, paddingVertical: 16, borderRadius: radius.lg,
                    backgroundColor: active ? colors.ember : colors.surface,
                    borderWidth: 2, borderColor: active ? colors.ember : colors.line,
                    alignItems: 'center', gap: spacing.sm,
                  }}
                >
                  <Image
                    source={PROVIDER_LOGOS[p]}
                    style={{ width: 44, height: 44, borderRadius: 10 }}
                    resizeMode="contain"
                  />
                  <AppText variant="label" color={active ? colors.onEmber : colors.ink} style={{ textAlign: 'center', marginTop: 2 }}>
                    {PROVIDER_LABELS[p]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <ProviderPhonePanel provider={provider} />

          <TextField
            containerStyle={{ marginTop: spacing.xl }}
            label={t('captain.wallet.topupModal.amountLabel')}
            icon="cash"
            value={amountMru}
            onChangeText={(text) => setAmountMru(text.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="1000"
          />

          <TextField
            containerStyle={{ marginTop: spacing.base }}
            label={t('captain.wallet.topupModal.refLabel')}
            value={refNumber}
            onChangeText={setRefNumber}
            placeholder={t('captain.wallet.topupModal.refPlaceholder')}
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
              {photoUri ? t('captain.wallet.topupModal.attached') : t('captain.wallet.topupModal.attachAction')}
            </AppText>
          </Pressable>

          <Button
            title={t('captain.wallet.topupModal.submit')}
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
