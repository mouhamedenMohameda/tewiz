/**
 * ScreenHeader — a compact back-button + title row used by detail screens.
 * Keeps the warm circular back affordance consistent across the app.
 */

import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { colors, radius, shadow, spacing } from '@/theme';
import { AppText } from './Text';
import { Icon } from './Icon';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function ScreenHeader({ title, subtitle, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      marginTop: spacing.sm, marginBottom: spacing.lg,
    }}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={{
            width: 44, height: 44, borderRadius: radius.md,
            backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
            ...shadow.card,
          }}
        >
          <Icon name="chevronBack" size={22} color={colors.ink} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {subtitle ? <AppText variant="overline" color={colors.muted}>{subtitle}</AppText> : null}
        <AppText variant="h2" numberOfLines={1} style={{ marginTop: subtitle ? 1 : 0 }}>{title}</AppText>
      </View>
      {right}
    </View>
  );
}
