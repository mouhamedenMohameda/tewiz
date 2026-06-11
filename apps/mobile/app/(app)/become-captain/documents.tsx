import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import {
  type AppDoc, type ApplicationDto, type DocumentType,
  DOC_LABELS, DOCUMENTS_WITH_EXPIRY, DOCUMENT_ORDER,
} from '@/lib/kyc';

export default function DocumentsScreen() {
  const router = useRouter();
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

  const byType = new Map<DocumentType, AppDoc>();
  for (const d of app?.documents ?? []) byType.set(d.type, d);

  const editable = !!app && (app.status === 'draft' || app.status === 'needs_correction');

  async function pickAndUpload(type: DocumentType, source: 'camera' | 'library') {
    if (!editable) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission requise', 'Accordez l\'accès dans les réglages.');
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
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ.');
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
      Alert.alert('Échec', e.response?.data?.error?.message ?? 'Impossible d\'envoyer le document.');
    } finally {
      setUploadingType(null);
    }
  }

  async function deleteDoc(doc: AppDoc) {
    if (!editable) return;
    Alert.alert(
      'Supprimer le document ?',
      DOC_LABELS[doc.type],
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/captain/applications/me/documents/${doc.id}`);
              await load();
            } catch (e: any) {
              Alert.alert('Erreur', e.response?.data?.error?.message ?? 'Échec.');
            }
          },
        },
      ],
    );
  }

  function openPicker(type: DocumentType) {
    Alert.alert(
      DOC_LABELS[type],
      'Choisissez la source',
      [
        { text: 'Appareil photo', onPress: () => pickAndUpload(type, 'camera') },
        { text: 'Galerie', onPress: () => pickAndUpload(type, 'library') },
        { text: 'Annuler', style: 'cancel' },
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
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#0f172a', marginTop: 12 }}>
          Documents
        </Text>
        <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Envoyez les 14 photos requises. Bien éclairées, sans reflet.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          {DOCUMENT_ORDER.map((t) => {
            const doc = byType.get(t);
            const uploading = uploadingType === t;
            return (
              <DocCard
                key={t}
                type={t}
                doc={doc}
                uploading={uploading}
                editable={editable}
                onPick={() => openPicker(t)}
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
              Date d'expiration
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              {pendingUpload ? DOC_LABELS[pendingUpload.type] : ''} — entrez la date au format AAAA-MM-JJ.
            </Text>
            <TextInput
              autoFocus
              value={expiryInput}
              onChangeText={setExpiryInput}
              placeholder="2026-12-31"
              keyboardType="numeric"
              maxLength={10}
              placeholderTextColor="#94a3b8"
              style={{
                marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1',
                borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                fontSize: 16, color: '#0f172a',
              }}
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
                <Text style={{ color: '#0f172a', fontWeight: '600' }}>Annuler</Text>
              </Pressable>
              <Pressable
                onPress={confirmExpiry}
                style={({ pressed }) => ({
                  flex: 1, padding: 12, borderRadius: 10,
                  backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
                  alignItems: 'center',
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Envoyer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DocCard({
  type, doc, uploading, editable, onPick, onDelete,
}: {
  type: DocumentType;
  doc?: AppDoc;
  uploading: boolean;
  editable: boolean;
  onPick: () => void;
  onDelete: () => void;
}) {
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
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#0f172a' }} numberOfLines={2}>
        {DOC_LABELS[type]}
      </Text>
      <View style={{ flex: 1 }} />
      {uploading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 12, color: '#64748b' }}>Envoi…</Text>
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
            {status === 'approved' ? '✓ VALIDÉ' :
              status === 'rejected' ? '✕ REJETÉ' :
              status === 'expired' ? 'EXPIRÉ' :
              '⏳ EN ATTENTE'}
          </Text>
          {doc.expiresAt ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              exp. {doc.expiresAt.slice(0, 10)}
            </Text>
          ) : null}
          {doc.rejectReason ? (
            <Text style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }} numberOfLines={2}>
              {doc.rejectReason}
            </Text>
          ) : null}
          {editable ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
              Touchez pour remplacer · Maintenir pour supprimer
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: '#64748b' }}>
          {editable ? 'Touchez pour ajouter' : 'Non envoyé'}
        </Text>
      )}
    </Pressable>
  );
}
