import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, PlainText as Text, PressableScale, Sheet } from '@/components/ui';
import { colors, radius, spacing, type as typo } from '@/theme';

export interface RideCancelReasonOption {
  key: string;
  label: string;
}

interface RideCancelReasonSheetProps {
  visible: boolean;
  title: string;
  body: string;
  options: RideCancelReasonOption[];
  busy?: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
}

export function RideCancelReasonSheet({
  visible,
  title,
  body,
  options,
  busy = false,
  onClose,
  onSelect,
}: RideCancelReasonSheetProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={body}
      // Cancelling a ride is consequential, but it is not irreversible and the
      // user can always ask again — so it stays dismissible. Trapping people in
      // a sheet to make them feel the weight of a choice is a tax, not a
      // safeguard.
      dismissible={!busy}
      maxHeightRatio={0.72}
    >
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ gap: spacing.sm }}
        showsVerticalScrollIndicator={false}
      >
        {options.map((option) => (
          <PressableScale
            key={option.key}
            disabled={busy}
            onPress={() => onSelect(option.key)}
            scaleTo={0.98}
            style={{
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.base,
              paddingVertical: spacing.base,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Text style={{ ...typo.bodyStrong, color: colors.ink }}>{option.label}</Text>
          </PressableScale>
        ))}
      </ScrollView>

      <View style={{ marginTop: spacing.base }}>
        <Button title={t('common.close')} variant="secondary" onPress={onClose} disabled={busy} />
      </View>
    </Sheet>
  );
}
