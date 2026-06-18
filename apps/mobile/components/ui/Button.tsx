/**
 * Button — the app's primary action surface.
 *
 *   <Button title="Commander" icon="voice" onPress={…} />
 *   <Button title="Choisir sur la carte" variant="secondary" icon="map" />
 *
 * `primary` paints a warm ember gradient with a matching glow; every variant
 * springs down on press (via PressableScale).
 */

import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, shadow, spacing, type as typo } from '@/theme';
import { AppText } from './Text';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger';
type Size = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PAD: Record<Size, { v: number; h: number; font: number; icon: number }> = {
  lg: { v: 17, h: 22, font: 16, icon: 21 },
  md: { v: 13, h: 18, font: 15, icon: 19 },
  sm: { v: 9, h: 14, font: 13, icon: 16 },
};

function tones(variant: Variant): { bg?: string; fg: string; border?: string } {
  switch (variant) {
    case 'primary': return { fg: colors.onEmber };
    case 'dark': return { bg: colors.espresso, fg: colors.onEspresso };
    case 'secondary': return { bg: colors.surface, fg: colors.ink, border: colors.lineStrong };
    case 'danger': return { bg: colors.dangerSoft, fg: colors.danger };
    case 'ghost': return { bg: 'transparent', fg: colors.ember };
  }
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  iconRight,
  busy,
  disabled,
  fullWidth = true,
  style,
}: ButtonProps) {
  const pad = PAD[size];
  const t = tones(variant);
  const isDisabled = disabled || busy;

  const inner = (
    <View style={[styles.row, { paddingVertical: pad.v, paddingHorizontal: pad.h }]}>
      {busy ? (
        <ActivityIndicator color={t.fg} style={{ marginRight: spacing.sm }} />
      ) : icon ? (
        <Icon name={icon} size={pad.icon} color={t.fg} />
      ) : null}
      <AppText
        style={{
          ...typo.title,
          fontSize: pad.font,
          color: t.fg,
          marginLeft: icon || busy ? spacing.sm : 0,
          marginRight: iconRight ? spacing.sm : 0,
        }}
      >
        {title}
      </AppText>
      {iconRight ? <Icon name={iconRight} size={pad.icon} color={t.fg} /> : null}
    </View>
  );

  const shape: StyleProp<ViewStyle> = {
    borderRadius: radius.lg,
    opacity: isDisabled ? 0.45 : 1,
    width: fullWidth ? '100%' : undefined,
  };

  if (variant === 'primary') {
    return (
      <PressableScale onPress={onPress} disabled={isDisabled} style={[shape, shadow.ember, style]}>
        <LinearGradient
          colors={gradients.ember}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { borderRadius: radius.lg }]}
        >
          {inner}
        </LinearGradient>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      style={[
        shape,
        styles.fill,
        {
          backgroundColor: t.bg,
          borderWidth: t.border ? 1 : 0,
          borderColor: t.border,
        },
        variant === 'dark' ? shadow.card : null,
        style,
      ]}
    >
      {inner}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
