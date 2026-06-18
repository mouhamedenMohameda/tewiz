/**
 * Shared form primitives so the KYC screens stay tidy.
 *
 * These now delegate to the design-system components (TextField / Button), so
 * every screen that already imports `Field` / `PrimaryButton` inherits the warm
 * "Sahara Solaire" styling for free — the public API is unchanged.
 */

import { Button, TextField } from '@/components/ui';
import { spacing } from '@/theme';

export function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, helper, maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  helper?: string;
  maxLength?: number;
}) {
  return (
    <TextField
      containerStyle={{ marginTop: spacing.base }}
      label={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      keyboardType={keyboardType ?? 'default'}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      maxLength={maxLength}
      helper={helper}
    />
  );
}

export function PrimaryButton({
  title, onPress, busy, disabled,
}: {
  title: string; onPress: () => void; busy?: boolean; disabled?: boolean;
}) {
  return (
    <Button
      title={title}
      onPress={onPress}
      busy={busy}
      disabled={disabled}
      style={{ marginTop: spacing.xl }}
    />
  );
}
