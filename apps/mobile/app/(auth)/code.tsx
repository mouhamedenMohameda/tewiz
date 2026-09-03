/**
 * Legacy OTP screen — now redirects to the password login screen.
 *
 * The OTP flow has been replaced by an admin-generated password (see
 * (auth)/phone.tsx). This file is kept so that any old deep links or
 * cached navigation state land somewhere sane instead of a blank route.
 */

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function LegacyCodeScreen() {
  useThemeRepaint();
  const router = useRouter();
  useEffect(() => {
    router.replace('/(auth)/phone');
  }, [router]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}>
      <ActivityIndicator color={colors.ember} />
    </View>
  );
}
