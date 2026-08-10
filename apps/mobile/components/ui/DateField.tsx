/**
 * DateField — a pressable input that opens a modal with three wheel pickers
 * (day, month, year). Pure JS so it works in Expo Go without a native dep.
 *
 * Value is stored as ISO `YYYY-MM-DD`. The wheels are FlatLists with
 * snap-to-interval that round to the nearest item on momentum end.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/theme';
import { haptics } from '@/lib/haptics';
import { AppText } from './Text';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

export interface DateFieldProps {
  label?: string;
  /** YYYY-MM-DD or empty string. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: string;
  /** Inclusive lower bound, default 1925-01-01. */
  minDate?: string;
  /** Inclusive upper bound, default today + 50 years. */
  maxDate?: string;
  /** Month labels in the user's language; defaults to numeric 01..12. */
  monthLabels?: string[];
  /** Modal title. */
  modalTitle?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

function parse(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function formatHuman(value: string, monthLabels?: string[]) {
  const p = parse(value);
  if (!p) return '';
  const month = monthLabels ? monthLabels[p.m - 1] : pad(p.m);
  return `${pad(p.d)} ${month} ${p.y}`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder,
  helper,
  minDate,
  maxDate,
  monthLabels,
  modalTitle,
  cancelLabel = 'Cancel',
  confirmLabel = 'OK',
  containerStyle,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  const minParsed = parse(minDate ?? '1925-01-01') ?? { y: 1925, m: 1, d: 1 };
  const todayDate = new Date();
  const defaultMax = `${todayDate.getFullYear() + 50}-12-31`;
  const maxParsed = parse(maxDate ?? defaultMax) ?? {
    y: todayDate.getFullYear() + 50, m: 12, d: 31,
  };

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = maxParsed.y; y >= minParsed.y; y--) arr.push(y);
    return arr;
  }, [minParsed.y, maxParsed.y]);
  const months = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], []);

  // Internal draft used while the modal is open.
  const initial = parse(value) ?? {
    y: todayDate.getFullYear(),
    m: todayDate.getMonth() + 1,
    d: todayDate.getDate(),
  };
  const [draftY, setDraftY] = useState(initial.y);
  const [draftM, setDraftM] = useState(initial.m);
  const [draftD, setDraftD] = useState(initial.d);

  useEffect(() => {
    if (open) {
      const p = parse(value) ?? initial;
      setDraftY(p.y); setDraftM(p.m); setDraftD(p.d);
    }
  }, [open]);

  // Clamp day when month/year changes.
  useEffect(() => {
    const max = daysInMonth(draftY, draftM);
    if (draftD > max) setDraftD(max);
  }, [draftY, draftM]);

  const days = useMemo(() => {
    const max = daysInMonth(draftY, draftM);
    const arr: number[] = [];
    for (let i = 1; i <= max; i++) arr.push(i);
    return arr;
  }, [draftY, draftM]);

  function confirm() {
    const iso = `${draftY}-${pad(draftM)}-${pad(draftD)}`;
    onChange(iso);
    setOpen(false);
  }

  const human = value ? formatHuman(value, monthLabels) : '';

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
          {label}
        </AppText>
      ) : null}

      <Pressable
        onPress={() => setOpen(true)}
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
        <Icon name="calendar" size={20} color={colors.muted} />
        <AppText style={{
          flex: 1,
          fontSize: 15,
          color: human ? colors.ink : colors.faint,
          fontFamily: fonts.text.medium,
        }}>
          {human || placeholder || ''}
        </AppText>
        <Icon name="chevronDown" size={20} color={colors.muted} />
      </Pressable>

      {helper ? (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs + 2 }}>
          {helper}
        </AppText>
      ) : null}

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={modalTitle}
        contentStyle={{ paddingHorizontal: 0 }}
      >
        <View style={{
          flexDirection: 'row',
          paddingHorizontal: spacing.lg,
          height: ITEM_HEIGHT * VISIBLE_ITEMS,
          position: 'relative',
        }}>
          {/* Highlight band for the centered row. */}
          <View pointerEvents="none" style={{
            position: 'absolute',
            left: spacing.lg, right: spacing.lg,
            top: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
            height: ITEM_HEIGHT,
            backgroundColor: colors.emberSoft,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.lineStrong,
          }} />

          <Wheel
            values={days}
            selected={draftD}
            onChange={setDraftD}
            renderLabel={(v) => pad(v)}
          />
          <Wheel
            values={months}
            selected={draftM}
            onChange={setDraftM}
            renderLabel={(v) => monthLabels?.[v - 1] ?? pad(v)}
          />
          <Wheel
            values={years}
            selected={draftY}
            onChange={setDraftY}
            renderLabel={(v) => String(v)}
          />
        </View>

        <View style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          marginTop: spacing.lg,
        }}>
          <Pressable
            onPress={() => setOpen(false)}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 14,
              borderRadius: radius.md,
              backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
              borderWidth: 1.5,
              borderColor: colors.line,
              alignItems: 'center',
            })}
          >
            <AppText style={{ fontSize: 15, fontFamily: fonts.text.semibold, color: colors.ink }}>
              {cancelLabel}
            </AppText>
          </Pressable>
          <Pressable
            onPress={confirm}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 14,
              borderRadius: radius.md,
              backgroundColor: pressed ? colors.emberDeep : colors.ember,
              alignItems: 'center',
            })}
          >
            <AppText style={{ fontSize: 15, fontFamily: fonts.text.bold, color: colors.onEmber }}>
              {confirmLabel}
            </AppText>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

function Wheel<T extends number>({
  values, selected, onChange, renderLabel,
}: {
  values: T[];
  selected: T;
  onChange: (v: T) => void;
  renderLabel: (v: T) => string;
}) {
  const listRef = useRef<FlatList<T>>(null);
  const padCount = Math.floor(VISIBLE_ITEMS / 2);

  // Scroll to the selected item when opened or when `selected` changes from outside.
  useEffect(() => {
    const idx = values.indexOf(selected);
    if (idx >= 0) {
      // Defer to allow layout.
      const t = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: idx * ITEM_HEIGHT, animated: false });
      }, 0);
      return () => clearTimeout(t);
    }
  }, [values, selected]);

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    const next = values[clamped];
    if (next !== undefined && next !== selected) {
      // A detent: the wheel came to rest on a different value. This is the
      // canonical case for a selection tick — one per landing, caused
      // unambiguously by this scroll, and it tells the user the value took
      // without them having to look down at the wheel.
      haptics.selection();
      onChange(next);
    }
    // Re-snap precisely (in case the scroll over/undershot the snap).
    listRef.current?.scrollToOffset({ offset: clamped * ITEM_HEIGHT, animated: true });
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(v) => String(v)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        // Let the ends rubber-band. Stopping dead at the first and last value
        // reads as the wheel having seized; resistance reads as "that's all
        // there is", which is what we actually mean.
        bounces
        onMomentumScrollEnd={handleMomentumEnd}
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: index * ITEM_HEIGHT,
          index,
        })}
        contentContainerStyle={{ paddingVertical: padCount * ITEM_HEIGHT }}
        renderItem={({ item }) => {
          const isActive = item === selected;
          return (
            <View style={{
              height: ITEM_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AppText style={{
                fontSize: isActive ? 18 : 16,
                color: isActive ? colors.ink : colors.muted,
                fontFamily: isActive ? fonts.text.bold : fonts.text.medium,
              }}>
                {renderLabel(item)}
              </AppText>
            </View>
          );
        }}
      />
    </View>
  );
}
