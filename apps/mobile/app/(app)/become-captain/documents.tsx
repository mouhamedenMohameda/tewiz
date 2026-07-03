import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateField, ScreenHeader } from '@/components/ui';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import {
  type AppDoc, type ApplicationDto, type DocumentType,
  DOCUMENTS_WITH_EXPIRY, DOCUMENT_ORDER, isDocRequired,
} from '@/lib/kyc';

export default function DocumentsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const docLabel = (type: DocumentType) => t(`becomeCaptain.documents.${type}` as const);
  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingType, setUploadingType] = useState<DocumentType | null>(null);

  // Expiry-date modal state.
  const [pendingUpload, setPendingUpload] = useState<{
    type: DocumentType; uri: string;
  } | null>(null);
  const [expiryInput, setExpiryInput] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<ApplicationDto>('/captain/applications/me');
      setApp(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const monthLabels = useMemo(
    () => (t('months', { returnObjects: true }) as unknown) as string[],
    [t],
  );

  // Expiry must be in the future. Allow up to 30 years out.
  const today = new Date();
  const minExpiry = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const maxExpiry = `${today.getFullYear() + 30}-12-31`;

  const byType = new Map<DocumentType, AppDoc>();
  for (const d of app?.documents ?? []) byType.set(d.type, d);

  const editable = !!app && (app.status === 'draft' || app.status === 'needs_correction');

  async function pickAndUpload(type: DocumentType, source: 'camera' | 'library') {
    if (!editable) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('common.permissionRequired'), t('common.permissionRequiredBody'));
      return;
    }
    const r = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7, allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7, allowsEditing: false,
        });
    if (r.canceled || !r.assets[0]) return;
    const uri = r.assets[0].uri;

    if (DOCUMENTS_WITH_EXPIRY.includes(type)) {
      setPendingUpload({ type, uri });
      setExpiryInput('');
      return;
    }
    await doUpload(type, uri, null);
  }

  async function confirmExpiry() {
    if (!pendingUpload) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryInput)) {
      Alert.alert(t('becomeCaptain.docs.expiryInvalidTitle'), t('becomeCaptain.docs.expiryInvalidBody'));
      return;
    }
    const { type, uri } = pendingUpload;
    setPendingUpload(null);
    await doUpload(type, uri, expiryInput);
  }

  async function doUpload(type: DocumentType, uri: string, expiresAt: string | null) {
    setUploadingType(type);
    try {
      const form = new FormData();
      form.append('file', {
        uri,
        name: `${type}.jpg`,
        type: 'image/jpeg',
      } as any);
      form.append('type', type);
      if (expiresAt) form.append('expiresAt', expiresAt);
      await api.post('/captain/applications/me/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
    } catch (e: any) {
      Alert.alert(t('captain.wallet.topupModal.failTitle'), e.response?.data?.error?.message ?? t('becomeCaptain.docs.uploadFail'));
    } finally {
      setUploadingType(null);
    }
  }

  async function deleteDoc(doc: AppDoc) {
    if (!editable) return;
    Alert.alert(
      t('becomeCaptain.docs.deleteTitle'),
      docLabel(doc.type),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/captain/applications/me/documents/${doc.id}`);
              await load();
            } catch (e: any) {
              Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('errors.generic'));
            }
          },
        },
      ],
    );
  }

  function openPicker(type: DocumentType) {
    Alert.alert(
      docLabel(type),
      t('becomeCaptain.docs.sourceTitle'),
      [
        { text: t('becomeCaptain.docs.sourceCamera'), onPress: () => pickAndUpload(type, 'camera') },
        { text: t('becomeCaptain.docs.sourceGallery'), onPress: () => pickAndUpload(type, 'library') },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <ScreenHeader title={t('becomeCaptain.docs.title')} onBack={() => router.back()} />
        <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          {t('becomeCaptain.docs.introV2')}
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          {DOCUMENT_ORDER.map((type) => {
            const doc = byType.get(type);
            const uploading = uploadingType === type;
            const required = app ? isDocRequired(app, type) : true;
            return (
              <DocCard
                key={type}
                type={type}
                doc={doc}
                uploading={uploading}
                editable={editable}
                required={required}
                label={docLabel(type)}
                onPick={() => openPicker(type)}
                onDelete={() => doc && deleteDoc(doc)}
              />
            );
          })}
        </View>
      </ScrollView>

      <Modal
        visible={!!pendingUpload}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingUpload(null)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(15,23,42,0.5)',
          justifyContent: 'center', padding: 24,
        }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a' }}>
              {t('becomeCaptain.docs.expiryTitle')}
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              {t('becomeCaptain.docs.expiryHintPicker', { label: pendingUpload ? docLabel(pendingUpload.type) : '' })}
            </Text>
            <DateField
              containerStyle={{ marginTop: 12 }}
              value={expiryInput}
              onChange={setExpiryInput}
              placeholder={t('becomeCaptain.docs.expiryTapToPick')}
              modalTitle={t('becomeCaptain.docs.expiryTitle')}
              cancelLabel={t('common.cancel')}
              confirmLabel={t('common.confirm')}
              minDate={minExpiry}
              maxDate={maxExpiry}
              monthLabels={Array.isArray(monthLabels) ? monthLabels : undefined}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Pressable
                onPress={() => setPendingUpload(null)}
                style={({ pressed }) => ({
                  flex: 1, padding: 12, borderRadius: 10,
                  backgroundColor: pressed ? '#e2e8f0' : '#f1f5f9',
                  alignItems: 'center',
                })}
              >
                <Text style={{ color: '#0f172a', fontWeight: '600' }}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={confirmExpiry}
                style={({ pressed }) => ({
                  flex: 1, padding: 12, borderRadius: 10,
                  backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
                  alignItems: 'center',
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>{t('common.send')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DocCard({
  type, doc, uploading, editable, required, label, onPick, onDelete,
}: {
  type: DocumentType;
  doc?: AppDoc;
  uploading: boolean;
  editable: boolean;
  required: boolean;
  label: string;
  onPick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const status = doc?.status;
  const borderColor =
    status === 'approved' ? '#bbf7d0' :
    status === 'rejected' ? '#fecaca' :
    status === 'pending' ? '#fde68a' : '#e2e8f0';
  const bg =
    status === 'approved' ? '#f0fdf4' :
    status === 'rejected' ? '#fef2f2' :
    status === 'pending' ? '#fefce8' : '#fff';

  return (
    <Pressable
      onPress={editable ? onPick : undefined}
      onLongPress={doc && editable ? onDelete : undefined}
      style={({ pressed }) => ({
        width: '47%',
        backgroundColor: pressed ? '#f1f5f9' : bg,
        borderColor, borderWidth: 1, borderRadius: 12,
        padding: 12, minHeight: 110,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          style={{ flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a' }}
          numberOfLines={2}
        >
          {label}
        </Text>
        {!required ? (
          <View style={{
            backgroundColor: '#e0e7ff',
            paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
          }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#4338ca' }}>
              {t('becomeCaptain.docs.optionalBadge')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      {uploading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 12, color: '#64748b' }}>{t('common.sending')}</Text>
        </View>
      ) : doc ? (
        <View>
          <Text style={{
            fontSize: 11, fontWeight: '700',
            color:
              status === 'approved' ? '#15803d' :
              status === 'rejected' ? '#b91c1c' :
              '#92400e',
          }}>
            {status === 'approved' ? `✓ ${t('becomeCaptain.docs.statusApproved')}` :
              status === 'rejected' ? `✕ ${t('becomeCaptain.docs.statusRejected')}` :
              status === 'expired' ? t('becomeCaptain.docs.statusExpired') :
              `⏳ ${t('becomeCaptain.docs.statusPending')}`}
          </Text>
          {doc.expiresAt ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {t('becomeCaptain.docs.expiresPrefix', { date: doc.expiresAt.slice(0, 10) })}
            </Text>
          ) : null}
          {doc.rejectReason ? (
            <Text style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }} numberOfLines={2}>
              {doc.rejectReason}
            </Text>
          ) : null}
          {editable ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
              {t('becomeCaptain.docs.replaceHint')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: '#64748b' }}>
          {editable
            ? (required
              ? t('becomeCaptain.docs.tapToAdd')
              : t('becomeCaptain.docs.tapToAddOptional'))
            : t('common.notSent')}
        </Text>
      )}
    </Pressable>
  );
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
