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
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { AppText, Button, Icon, PressableScale, Sheet } from '@/components/ui';
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
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('carRental.rate.title')}
      subtitle={t('carRental.rate.prompt', { name })}
      dismissible={!busy}
      contentStyle={{ gap: spacing.base }}
    >
      {/* Was a centred dialog. It carries a keyboard, and on a phone a form
          floating in the middle of the screen puts its input under the
          keyboard and its controls out of thumb reach. Same content, anchored
          where the hand is. */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', paddingVertical: spacing.sm }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale key={n} onPress={() => setStars(n)} hitSlop={6} scaleTo={0.85} haptic>
            <Icon name="star" size={38} color={n <= stars ? colors.warning : colors.sunken} />
          </PressableScale>
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
    </Sheet>
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
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={hint}
      dismissible={!busy && !uploading}
      contentStyle={{ gap: spacing.base }}
    >
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
                  // Neutral rather than the warm palette: this badge sits on
                  // arbitrary user photos, where contrast beats brand.
                  style={{ position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.sm, padding: 2 }}>
                  <Icon name="close" size={13} color={colors.white} />
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
    </Sheet>
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
