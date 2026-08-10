/**
 * Shared modals for the Location Auto trust checkpoints:
 *   - RatingModal        : bilateral star rating after a completed rental
 *   - BookingActionModal : enter an OTP and/or attach état-des-lieux photos
 *                          (pickup, return, confirm-return, dispute)
 *
 * Kept out of the app/ route tree on purpose so expo-router doesn't treat it
 * as a screen.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { AppText, Button, Icon } from '@/components/ui';
import { uploadCarPhoto } from '@/lib/carRental';
import { colors, fonts, radius, spacing, statusTone } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';

export function RatingModal({ visible, name, busy, onSubmit, onClose }: {
  visible: boolean;
  name: string;
  busy: boolean;
  onSubmit: (stars: number, comment: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (visible) { setStars(5); setComment(''); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: spacing.lg }}>
        <View style={{ backgroundColor: colors.canvas, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.base }}>
          <AppText variant="h2">{t('carRental.rate.title')}</AppText>
          <AppText variant="body" color={colors.ink2}>{t('carRental.rate.prompt', { name })}</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', paddingVertical: spacing.sm }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
                <Icon name="star" size={38} color={n <= stars ? colors.warning : colors.sunken} />
              </Pressable>
            ))}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t('carRental.rate.commentPlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            style={{
              borderWidth: 1, borderColor: colors.sunken, borderRadius: radius.md,
              paddingHorizontal: spacing.base, paddingVertical: spacing.md,
              minHeight: 64, textAlignVertical: 'top', color: colors.ink,
              fontFamily: isRTL(currentLanguage()) ? fonts.arabic.regular : undefined,
            }}
          />
          <Button title={t('carRental.rate.submitBtn')} icon="check" busy={busy} onPress={() => onSubmit(stars, comment)} />
          <Button title={t('carRental.rate.cancelBtn')} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export function BookingActionModal({
  visible, title, hint, requireOtp, withPhotos, submitLabel, busy, onSubmit, onClose,
}: {
  visible: boolean;
  title: string;
  hint: string;
  requireOtp: boolean;
  withPhotos: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (otp: string, photos: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [otp, setOtp] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) { setOtp(''); setPhotos([]); setUploading(false); }
  }, [visible]);

  async function addPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadCarPhoto(r.assets[0].uri);
      setPhotos((prev) => [...prev, url]);
    } catch {
      Alert.alert(t('carRental.errTitle'), t('carRental.add.errUploadPhoto'));
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = !uploading && (!requireOtp || otp.trim().length >= 3);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: spacing.lg }}>
        <View style={{ backgroundColor: colors.canvas, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.base }}>
          <AppText variant="h2">{title}</AppText>
          <AppText variant="body" color={colors.ink2}>{hint}</AppText>

          {requireOtp && (
            <TextInput
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              placeholder={t('carRental.otp.placeholder')}
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1, borderColor: colors.sunken, borderRadius: radius.md,
                paddingHorizontal: spacing.base, paddingVertical: spacing.md,
                // Arabic placeholder is cursive: letterSpacing breaks its
                // shaping, so only space out the typed digits.
                fontSize: 26, letterSpacing: isRTL(currentLanguage()) && !otp ? 0 : 4,
                textAlign: 'center', color: colors.ink,
                fontFamily: isRTL(currentLanguage()) ? fonts.arabic.regular : undefined,
              }}
            />
          )}

          {withPhotos && (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="caption" color={colors.muted}>{t('carRental.photos.label')}</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {photos.map((p) => (
                  <View key={p}>
                    <Image source={{ uri: p }} style={{ width: 92, height: 74, borderRadius: radius.md }} />
                    <Pressable onPress={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                      style={{ position: 'absolute', top: 3, right: 3, backgroundColor: '#000a', borderRadius: radius.sm, padding: 2 }}>
                      <Icon name="close" size={13} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                <Pressable onPress={addPhoto} disabled={uploading}
                  style={{ width: 92, height: 74, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
                  {uploading ? <ActivityIndicator color={colors.ember} /> : <Icon name="sparkle" size={20} color={colors.muted} />}
                </Pressable>
              </ScrollView>
            </View>
          )}

          <Button title={submitLabel} icon="check" busy={busy} disabled={!canSubmit} onPress={() => onSubmit(otp.trim(), photos)} />
          <Button title={t('carRental.otp.cancelBtn')} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const OTP_BOX = {
  backgroundColor: statusTone.done.bg,
  borderRadius: radius.md,
  padding: spacing.base,
  gap: 4,
} as const;

/** Big highlighted code the holder reads out to the other party. */
export function OtpDisplay({ label, code, hint }: { label: string; code: string; hint: string }) {
  return (
    <View style={OTP_BOX}>
      <AppText variant="caption" color={colors.success}>{label}</AppText>
      <AppText variant="title" style={{ fontSize: 32, letterSpacing: 6, color: colors.success }}>{code}</AppText>
      <AppText variant="caption" color={colors.ink2}>{hint}</AppText>
    </View>
  );
}
