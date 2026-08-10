/**
 * UpdateGate — full-screen blocking "please update" screen.
 *
 * Shown when the running build's version is lower than the server-mandated
 * minimum (app config `minAndroidVersion` / `minIosVersion`, set from the admin
 * back-office). Mounted at the root so it covers every screen, including the
 * auth flow — an outdated build is blocked before it can even sign in.
 *
 * HARD LIMIT: this only protects builds that already contain this component.
 * A binary shipped before the gate existed has no such screen, so bumping the
 * minimum version kills every *future* build below it, never one already
 * installed without the gate. That is a platform constraint, not a bug.
 */

import { Linking, Platform, Pressable, View } from 'react-native';
import * as Application from 'expo-application';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PlainText as Text } from '@/components/ui';
import { useAppConfig, isUpdateRequired } from '@/lib/appConfig';
import { APP_NAME } from '@/lib/brand';
import { colors, radius } from '@/theme';

export default function UpdateGate() {
  const { t } = useTranslation();
  const cfg = useAppConfig();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const localVersion = Application.nativeApplicationVersion ?? null;

  if (!isUpdateRequired(cfg, platform, localVersion)) return null;

  const storeUrl = platform === 'ios' ? cfg.latestIosUrl : cfg.latestAndroidUrl;

  async function openStore() {
    if (!storeUrl) return;
    try {
      if (await Linking.canOpenURL(storeUrl)) await Linking.openURL(storeUrl);
    } catch {
      // Nothing else to do — the screen stays up; the user can retry.
    }
  }

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.ink, zIndex: 9999,
    }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{
          width: 72, height: 72, borderRadius: 36, backgroundColor: colors.ember,
          alignItems: 'center', justifyContent: 'center', marginBottom: 24,
        }}>
          <Text style={{ fontSize: 34 }}>⬆️</Text>
        </View>

        <Text style={{ color: colors.white, fontSize: 26, fontWeight: '700', textAlign: 'center' }}>
          {t('update.title')}
        </Text>
        <Text style={{ color: colors.lineStrong, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12 }}>
          {t('update.body', { app: APP_NAME })}
        </Text>

        {storeUrl ? (
          <Pressable
            onPress={openStore}
            style={({ pressed }) => ({
              marginTop: 32, alignSelf: 'stretch',
              backgroundColor: pressed ? colors.emberDeep : colors.ember,
              paddingVertical: 16, borderRadius: radius.lg, alignItems: 'center',
            })}
          >
            <Text style={{ color: colors.white, fontSize: 15, fontWeight: '700' }}>
              {t('update.cta')}
            </Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.faint, fontSize: 13, textAlign: 'center', marginTop: 28 }}>
            {t('update.noLink')}
          </Text>
        )}
      </SafeAreaView>
    </View>
  );
}
