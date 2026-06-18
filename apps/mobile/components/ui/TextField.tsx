/**
 * TextField — a warm, focus-aware input.
 *
 * Leading icon, floating label, focus highlight (border + soft ember tint) and
 * an optional built-in show/hide toggle for passwords. Replaces the old flat
 * slate-bordered inputs.
 */

import { useState, type ReactNode } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, spacing, type as typo } from '@/theme';
import { AppText } from './Text';
import { Icon, type IconName } from './Icon';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  icon?: IconName;
  helper?: string;
  /** Renders a built-in password show/hide eye toggle. */
  secure?: boolean;
  /** Monospace input (codes / passwords). */
  mono?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  icon,
  helper,
  secure,
  mono,
  containerStyle,
  ...input
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
          {label}
        </AppText>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: focused ? colors.emberSoft : colors.surface,
          borderWidth: 1.5,
          borderColor: focused ? colors.ember : colors.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.base,
          gap: spacing.md,
        }}
      >
        {icon ? (
          <Icon name={icon} size={20} color={focused ? colors.ember : colors.muted} />
        ) : null}

        <TextInput
          {...input}
          secureTextEntry={secure ? hidden : input.secureTextEntry}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          placeholderTextColor={colors.faint}
          style={{
            flex: 1,
            paddingVertical: 15,
            fontSize: 16,
            color: colors.ink,
            fontFamily: mono ? fonts.mono : fonts.text.medium,
            letterSpacing: mono ? 2 : 0,
          }}
        />

        {secure ? (
          <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {helper ? (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs + 2 }}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}
