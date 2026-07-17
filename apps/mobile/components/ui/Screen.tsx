/**
 * Screen — the warm canvas every page sits on. Handles safe-area insets and
 * (optionally) scrolling + pull-to-refresh, so screens stop re-deriving the
 * same SafeAreaView + ScrollView boilerplate.
 */

import { type ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

// Above this window width (iPad mini portrait and up) we stop stretching the
// phone-optimized layout edge-to-edge and instead center a phone-width
// column, so cards/buttons don't blow up to awkward sizes on tablets.
const WIDE_LAYOUT_BREAKPOINT = 680;
const WIDE_LAYOUT_MAX_CONTENT_WIDTH = 480;

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
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_LAYOUT_BREAKPOINT;

  const pad: StyleProp<ViewStyle> = padded
    ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
    : null;
  const constrain: StyleProp<ViewStyle> = isWide
    ? { width: '100%', maxWidth: WIDE_LAYOUT_MAX_CONTENT_WIDTH, alignSelf: 'center' }
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={edges}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={isWide ? { flexGrow: 1, alignItems: 'center' } : undefined}
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
          <View style={[{ width: '100%', paddingBottom: spacing.huge }, pad, constrain, contentStyle]}>
            {children}
          </View>
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, isWide && { alignItems: 'center' }]}>
          <View style={[{ flex: 1, width: '100%' }, pad, constrain, contentStyle]}>{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}
