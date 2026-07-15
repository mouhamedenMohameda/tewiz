import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { colors, radius, shadow, spacing } from '@/theme';

export interface BottomSheetProps {
  /** Total sheet height when fully expanded (its resting height). */
  expandedHeight: number;
  /** How much of the sheet stays visible above the screen edge when collapsed. */
  collapsedHeight: number;
  children: ReactNode;
}

const SPRING = { damping: 22, stiffness: 220, mass: 0.9 } as const;

/**
 * Two-snap draggable bottom sheet (collapsed ↔ expanded).
 *
 * The pan/tap gesture lives on the HANDLE only, so a ScrollView inside
 * `children` scrolls without fighting the sheet (the classic gorhom problem we
 * sidestep by not making the whole surface draggable). Built entirely on the
 * gesture-handler + reanimated the app already ships — no extra native module,
 * so it works in the existing dev build without an EAS rebuild.
 */
export function BottomSheet({ expandedHeight, collapsedHeight, children }: BottomSheetProps) {
  const maxY = Math.max(0, expandedHeight - collapsedHeight);
  const translateY = useSharedValue(maxY); // start collapsed
  const startY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.min(Math.max(startY.value + e.translationY, 0), maxY);
    })
    .onEnd((e) => {
      // Fling: project a little past the finger so a quick flick commits.
      const projected = translateY.value + e.velocityY * 0.12;
      translateY.value = withSpring(projected > maxY / 2 ? maxY : 0, SPRING);
    });

  const tap = Gesture.Tap().onEnd(() => {
    translateY.value = withSpring(translateY.value > maxY / 2 ? 0 : maxY, SPRING);
  });

  const gesture = Gesture.Exclusive(pan, tap);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: expandedHeight,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
          ...shadow.raised,
        },
        sheetStyle,
      ]}
    >
      <GestureDetector gesture={gesture}>
        <View
          hitSlop={12}
          style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' }}
        >
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong }} />
        </View>
      </GestureDetector>
      {children}
    </Animated.View>
  );
}
