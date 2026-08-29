/**
 * Prise de photo d'un document, partagée par la candidature Captain et la
 * complétion de profil qui suit l'acceptation.
 *
 * Deux partis pris hérités de l'onboarding v3, où chaque tap compte :
 *
 *  - Toucher la carte ouvre DIRECTEMENT l'appareil photo. L'ancienne version
 *    affichait d'abord une alerte « appareil photo / galerie » : un tap de
 *    plus par document, alors qu'il s'agit de photographier un papier qu'on a
 *    en main. La galerie reste accessible par la petite icône du coin, pour
 *    le cas minoritaire (photo déjà prise, papier chez le propriétaire).
 *
 *  - Après un envoi réussi on revient à la grille. On ne relance pas la
 *    caméra pour le document suivant : le captain garde la main sur son
 *    rythme, et voit ce qu'il lui reste.
 */

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { PlainText as Text } from '@/components/ui';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiError';
import { type AppDoc, type DocumentType, DOCUMENTS_WITH_EXPIRY } from '@/lib/kyc';
import { colors, radius, statusTone } from '@/theme';

export interface PendingUpload {
  type: DocumentType;
  uri: string;
}

interface UploadOptions {
  /** Rechargement du dossier après un envoi réussi. */
  onUploaded: () => Promise<void> | void;
  /** Les documents à date d'expiration passent par là avant l'envoi. */
  onNeedExpiry: (pending: PendingUpload) => void;
}

export function useDocumentUpload({ onUploaded, onNeedExpiry }: UploadOptions) {
  const { t } = useTranslation();
  const [uploadingType, setUploadingType] = useState<DocumentType | null>(null);

  async function capture(type: DocumentType, source: 'camera' | 'library') {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('common.permissionRequired'), t('common.permissionRequiredBody'));
      return;
    }
    const r = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (r.canceled || !r.assets[0]) return;

    if (DOCUMENTS_WITH_EXPIRY.includes(type)) {
      onNeedExpiry({ type, uri: r.assets[0].uri });
      return;
    }
    await upload(type, r.assets[0].uri, null);
  }

  async function upload(type: DocumentType, uri: string, expiresAt: string | null) {
    setUploadingType(type);
    try {
      const fd = new FormData();
      fd.append('file', { uri, name: `${type}.jpg`, type: 'image/jpeg' } as any);
      fd.append('type', type);
      if (expiresAt) fd.append('expiresAt', expiresAt);
      await api.post('/captain/applications/me/documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await onUploaded();
    } catch (e: any) {
      Alert.alert(t('common.error'), apiErrorMessage(e, t, t('becomeCaptain.docs.uploadFail')));
    } finally {
      setUploadingType(null);
    }
  }

  return { uploadingType, capture, upload };
}

export function DocumentCard({
  type, doc, uploading, editable, onCapture,
}: {
  type: DocumentType;
  doc?: AppDoc;
  uploading: boolean;
  editable: boolean;
  onCapture: (source: 'camera' | 'library') => void;
}) {
  const { t } = useTranslation();
  const label = t(`becomeCaptain.documents.${type}` as const);
  const status = doc?.status;
  const borderColor =
    status === 'approved' ? statusTone.done.bg : status === 'rejected' ? colors.dangerSoft :
    status === 'pending' ? statusTone.pending.bg : colors.line;
  const bg =
    status === 'approved' ? statusTone.done.bg : status === 'rejected' ? statusTone.failed.bg :
    status === 'pending' ? statusTone.pending.bg : '#fff';

  return (
    <Pressable
      onPress={editable ? () => onCapture('camera') : undefined}
      style={({ pressed }) => ({
        width: '47%', backgroundColor: pressed ? colors.line : bg,
        borderColor, borderWidth: 1, borderRadius: radius.md, padding: 12, minHeight: 110,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }} numberOfLines={2}>
        {label}
      </Text>

      <View style={{ flex: 1 }} />

      {uploading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 12, color: colors.ink2 }}>{t('common.sending')}</Text>
        </View>
      ) : doc ? (
        <View>
          <Text style={{
            fontSize: 11, fontWeight: '700',
            color: status === 'approved' ? statusTone.done.fg
              : status === 'rejected' ? colors.danger : statusTone.pending.fg,
          }}>
            {status === 'approved' ? `✓ ${t('becomeCaptain.docs.statusApproved')}`
              : status === 'rejected' ? `✕ ${t('becomeCaptain.docs.statusRejected')}`
              : status === 'expired' ? t('becomeCaptain.docs.statusExpired')
              : `⏳ ${t('becomeCaptain.docs.statusPending')}`}
          </Text>
          {doc.expiresAt ? (
            <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 2 }}>
              {t('becomeCaptain.docs.expiresPrefix', { date: doc.expiresAt.slice(0, 10) })}
            </Text>
          ) : null}
          {doc.rejectReason ? (
            <Text style={{ fontSize: 11, color: colors.danger, marginTop: 2 }} numberOfLines={2}>
              {doc.rejectReason}
            </Text>
          ) : null}
          {editable ? (
            <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 4 }}>
              {t('becomeCaptain.docs.retakeHint')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: colors.ink2 }}>
          {editable ? t('becomeCaptain.docs.tapToShoot') : t('common.notSent')}
        </Text>
      )}

      {/* Toucher la carte ouvre l'appareil photo — le bon geste pour une pièce
          que le captain a sous les yeux. Reste le cas où la photo est déjà dans
          le téléphone (papier scanné, reçu par WhatsApp) : l'icône seule dans un
          coin ne se voyait pas, d'où une pastille libellée avec une vraie cible
          tactile. `stopPropagation` empêche le Pressable parent de lancer
          l'appareil photo par-dessus. */}
      {editable && !uploading ? (
        <Pressable
          onPress={(e) => { e.stopPropagation(); onCapture('library'); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('becomeCaptain.docs.sourceGallery')}
          style={({ pressed }) => ({
            marginTop: 8, alignSelf: 'flex-start',
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingVertical: 5, paddingHorizontal: 9,
            borderRadius: radius.xs, borderWidth: 1, borderColor: colors.lineStrong,
            backgroundColor: pressed ? colors.line : 'transparent',
          })}
        >
          <Text style={{ fontSize: 12 }}>🖼</Text>
          <Text style={{ fontSize: 11, fontWeight: '600', color: colors.ink2 }}>
            {t('becomeCaptain.docs.sourceGallery')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
