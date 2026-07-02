/**
 * Screen — the warm canvas every page sits on. Handles safe-area insets and
 * (optionally) scrolling + pull-to-refresh, so screens stop re-deriving the
 * same SafeAreaView + ScrollView boilerplate.
 */

import { type ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  background?: string;
  edges?: readonly Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Screen({
  children,
  scroll = false,
  onRefresh,
  refreshing = false,
  background = colors.canvas,
  edges = ['top', 'left', 'right'],
  contentStyle,
  padded = true,
}: ScreenProps) {
  const pad: StyleProp<ViewStyle> = padded
    ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={edges}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[{ paddingBottom: spacing.huge }, pad, contentStyle]}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.ember}
                colors={[colors.ember]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
