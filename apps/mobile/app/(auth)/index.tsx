/**
 * Welcome / entry screen.
 *
 * No sign-up required: the primary CTA enters the app as an anonymous guest
 * rider (POST /auth/guest). The phone number is captured later, the first time
 * it's actually needed (before a ride or a captain application). Users who
 * already have an account (e.g. a captain on a new device) can still log in via
 * the secondary "J'ai déjà un compte" action.
 *
 * Visual: a golden-hour gradient header carries the brand; the actions sit on
 * the warm sand canvas below.
 */

import { useState } from 'react';
import { Alert, Dimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { loginAsGuest } from '@/lib/guest';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { AppText, Button, FadeInView, Icon } from '@/components/ui';

const { height: SCREEN_H } = Dimensions.get('window');

export default function AuthWelcome() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function startGuest() {
    setBusy(true);
    try {
      await loginAsGuest();
      router.replace('/(app)');
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message
        ?? 'Impossible de se connecter au serveur. Vérifiez votre connexion.';
      Alert.alert('Erreur', msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Golden-hour header wash */}
      <LinearGradient
        colors={gradients.sunrise}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: SCREEN_H * 0.56,
          borderBottomLeftRadius: 44,
          borderBottomRightRadius: 44,
        }}
      />
      {/* Faint sun glow behind the brand */}
      <View
        style={{
          position: 'absolute',
          top: SCREEN_H * 0.06,
          alignSelf: 'center',
          width: 260, height: 260, borderRadius: 130,
          backgroundColor: colors.saffron,
          opacity: 0.35,
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' }}>
          {/* Brand */}
          <FadeInView delay={80} style={{ alignItems: 'center', marginTop: SCREEN_H * 0.12 }}>
            <View
              style={{
                width: 104, height: 104, borderRadius: 30,
                backgroundColor: colors.surface,
                alignItems: 'center', justifyContent: 'center',
                ...shadow.raised,
              }}
            >
              <Icon name="ride" size={52} color={colors.ember} />
            </View>

            <AppText
              variant="hero"
              color={colors.white}
              style={{ marginTop: spacing.lg, fontSize: 46, letterSpacing: -1.2 }}
            >
              Tewiz
            </AppText>
            <AppText
              variant="title"
              color="#FFF4E6"
              align="center"
              style={{ marginTop: spacing.xs, maxWidth: 280, opacity: 0.95 }}
            >
              Commandez une course. Conduisez quand vous voulez.
            </AppText>
          </FadeInView>

          {/* Actions */}
          <FadeInView delay={260}>
            <Button
              title="Commander une course"
              variant="dark"
              iconRight="arrow"
              busy={busy}
              onPress={startGuest}
            />
            <View style={{ height: spacing.md }} />
            <Button
              title="J'ai déjà un compte"
              variant="secondary"
              icon="person"
              onPress={() => router.push('/(auth)/phone')}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                marginTop: spacing.xl,
                marginBottom: spacing.sm,
                paddingHorizontal: spacing.base,
              }}
            >
              <Icon name="shield" size={15} color={colors.muted} />
              <AppText variant="caption" color={colors.muted} align="center" style={{ flexShrink: 1 }}>
                Aucune inscription requise. Entrez votre numéro au moment de commander.
              </AppText>
            </View>
          </FadeInView>
        </View>
      </SafeAreaView>
    </View>
  );
}
