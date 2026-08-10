/**
 * SelectField — a pressable input that opens a modal list of options.
 *
 * Built to make filling KYC-style forms easier: instead of free-text typing
 * a car brand or colour, the user taps the field and picks from a curated
 * list. Optional search filters long lists (brands).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { AppText } from './Text';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional small color swatch shown left of the label (for colour pickers). */
  swatch?: string;
}

export interface SelectFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: IconName;
  helper?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  modalTitle?: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Custom rendering of the selected value (e.g. with a colour swatch). */
  renderSelected?: (option: SelectOption | null) => ReactNode;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  icon,
  helper,
  searchable,
  searchPlaceholder,
  modalTitle,
  containerStyle,
  renderSelected,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Arabic search input must render in Cairo (Sora lacks Arabic glyphs). The
  // selected value / placeholder / option labels go through AppText, which
  // already handles the Cairo swap.
  const ar = isRTL(currentLanguage());

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
          {label}
        </AppText>
      ) : null}

      <Pressable
        onPress={() => { setQuery(''); setOpen(true); }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: pressed ? colors.emberSoft : colors.surface,
          borderWidth: 1.5,
          borderColor: colors.line,
          borderRadius: radius.md,
          paddingHorizontal: spacing.base,
          paddingVertical: 15,
          gap: spacing.md,
          minHeight: 54,
        })}
      >
        {icon ? <Icon name={icon} size={20} color={colors.muted} /> : null}

        <View style={{ flex: 1 }}>
          {renderSelected ? (
            renderSelected(selected)
          ) : selected ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {selected.swatch ? <Swatch color={selected.swatch} /> : null}
              <AppText
                style={{ fontSize: 15, color: colors.ink, fontFamily: fonts.text.medium }}
              >
                {selected.label}
              </AppText>
            </View>
          ) : (
            <AppText style={{ fontSize: 15, color: colors.faint, fontFamily: fonts.text.medium }}>
              {placeholder ?? ''}
            </AppText>
          )}
        </View>

        <Icon name="chevronDown" size={20} color={colors.muted} />
      </Pressable>

      {helper ? (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs + 2 }}>
          {helper}
        </AppText>
      ) : null}

      {/* The picker rises from the bottom edge and returns to it, is draggable
          and flickable, and dims what's behind — the same sheet the rest of the
          app uses. It used to cross-fade in place, which reads as a different
          kind of surface from every other sheet in the product even though it
          does the same job. `contentStyle` drops the sheet's own horizontal
          padding because the rows are full-bleed and pad themselves. */}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={modalTitle}
        maxHeightRatio={0.8}
        contentStyle={{ paddingHorizontal: 0, paddingTop: spacing.sm }}
      >
        {searchable ? (
          <View style={{
            marginHorizontal: spacing.lg,
            marginBottom: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.sunken,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: colors.line,
            paddingHorizontal: spacing.base,
            gap: spacing.sm,
          }}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                flex: 1,
                paddingVertical: 12,
                fontSize: 15,
                color: colors.ink,
                fontFamily: ar ? fonts.arabic.medium : fonts.text.medium,
              }}
            />
          </View>
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
          renderItem={({ item }) => {
            const isActive = item.value === value;
            return (
              <Pressable
                onPress={() => { onChange(item.value); setOpen(false); }}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  backgroundColor: pressed ? colors.emberSoft : 'transparent',
                })}
              >
                {item.swatch ? <Swatch color={item.swatch} large /> : null}
                <AppText style={{
                  flex: 1,
                  fontSize: 15,
                  color: colors.ink,
                  fontFamily: isActive ? fonts.text.bold : fonts.text.medium,
                }}>
                  {item.label}
                </AppText>
                {isActive ? (
                  <Icon name="checkSmall" size={20} color={colors.ember} />
                ) : null}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: spacing.lg }} />
          )}
        />
      </Sheet>
    </View>
  );
}

function Swatch({ color, large }: { color: string; large?: boolean }) {
  const size = large ? 22 : 18;
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      borderWidth: 1,
      borderColor: colors.lineStrong,
    }} />
  );
}
