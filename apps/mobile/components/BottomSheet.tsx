import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { colors, radius, shadow, spacing } from '@/theme';

export interface BottomSheetProps {
  /** Total sheet height when fully expanded (its resting height). */
  expandedHeight: number;
  /** How much of the sheet stays visible above the screen edge when collapsed. */
  collapsedHeight: number;
  children: ReactNode;
}

const SPRING = {
  bounciness: 0,
  speed: 18,
  useNativeDriver: true,
} as const;

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
  const translateY = useRef(new Animated.Value(maxY)).current;
  const currentY = useRef(maxY);
  const startY = useRef(maxY);

  useEffect(() => {
    currentY.current = maxY;
    startY.current = maxY;
    translateY.setValue(maxY);
  }, [maxY, translateY]);

  function animateTo(nextY: number) {
    currentY.current = nextY;
    Animated.spring(translateY, {
      ...SPRING,
      toValue: nextY,
    }).start();
  }

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dy) > 3 || Math.abs(gestureState.dx) > 3
    ),
    onPanResponderGrant: () => {
      startY.current = currentY.current;
    },
    onPanResponderMove: (_, gestureState) => {
      const nextY = Math.min(Math.max(startY.current + gestureState.dy, 0), maxY);
      currentY.current = nextY;
      translateY.setValue(nextY);
    },
    onPanResponderRelease: (_, gestureState) => {
      const projected = currentY.current + gestureState.vy * 120;
      animateTo(projected > maxY / 2 ? maxY : 0);
    },
    onPanResponderTerminate: (_, gestureState) => {
      const projected = currentY.current + gestureState.vy * 120;
      animateTo(projected > maxY / 2 ? maxY : 0);
    },
  }), [maxY, translateY]);

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
        {
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        {...panResponder.panHandlers}
        style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' }}
      >
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong }} />
      </View>
      {children}
    </Animated.View>
  );
}
