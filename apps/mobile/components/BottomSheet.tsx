import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { colors, motion, radius, shadowTint, spacing } from '@/theme';
import {
  clampWithResistance,
  settleTarget,
  springConfig,
  toVelocityPerSecond,
} from '@/lib/motion';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { haptics } from '@/lib/haptics';

export interface BottomSheetProps {
  /** Total sheet height when fully expanded (its resting height). */
  expandedHeight: number;
  /** How much of the sheet stays visible above the screen edge when collapsed. */
  collapsedHeight: number;
  children: ReactNode;
}

/** Anything smaller than this at release is a tap, not a drag. */
const TAP_SLOP = 4;
/** Movement needed before we claim the gesture from whatever is underneath. */
const DRAG_THRESHOLD = 3;

/**
 * Two-snap draggable bottom sheet (collapsed ↔ expanded).
 *
 * The pan/tap gesture lives on the HANDLE only, so a ScrollView inside
 * `children` scrolls without fighting the sheet (the classic gorhom problem we
 * sidestep by not making the whole surface draggable). Drag it, flick it, or
 * tap the handle to toggle.
 *
 * What makes it feel like iOS rather than like a div that moves:
 *
 *  - It is INTERRUPTIBLE. Grabbing the handle mid-flight picks up from where
 *    the sheet visually IS, not from where it was heading. Reading the target
 *    instead of the presented position is what causes the classic jump when you
 *    catch something in motion — the whole point is that the thought and the
 *    gesture happen in parallel, so the sheet must never make you wait out an
 *    animation you've already changed your mind about.
 *  - The release VELOCITY is handed to the spring, so there is no seam between
 *    dragging and animating — the sheet just keeps going at the speed your
 *    finger left it at.
 *  - A flick is PROJECTED forward the way a scroll view projects its landing
 *    point, so a short fast flick commits to the far end. Judging by distance
 *    travelled alone makes a decisive flick spring back, which reads as broken.
 *  - Both ends RUBBER-BAND rather than stopping dead, so an edge says "nothing
 *    more here" instead of "frozen".
 *
 * Built on PanResponder + the built-in Animated API — no gesture-handler, no
 * reanimated, no extra native module, so it runs in Expo Go and in the
 * existing dev build without an EAS rebuild.
 */
export function BottomSheet({ expandedHeight, collapsedHeight, children }: BottomSheetProps) {
  const maxY = Math.max(0, expandedHeight - collapsedHeight);
  const translateY = useRef(new Animated.Value(maxY)).current;
  /** The sheet's LIVE on-screen offset, mirrored so a gesture can grab it. */
  const liveY = useRef(maxY);
  /** Where the current drag started from. */
  const startY = useRef(maxY);
  /** The snap point we last came to rest on — used to only buzz on a change. */
  const restingAt = useRef(maxY);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const id = translateY.addListener(({ value }) => { liveY.current = value; });
    return () => translateY.removeListener(id);
  }, [translateY]);

  useEffect(() => {
    liveY.current = maxY;
    startY.current = maxY;
    restingAt.current = maxY;
    translateY.setValue(maxY);
  }, [maxY, translateY]);

  const animateTo = useCallback((nextY: number, velocity = 0) => {
    const changed = restingAt.current !== nextY;
    restingAt.current = nextY;
    // The haptic fires now, with the motion — not when the spring settles.
    // Feedback that trails the visual by 300ms reads as a second, unrelated
    // event rather than as confirmation of this one.
    if (changed) haptics.impact();

    if (reduceMotion) {
      // Reduce Motion can't take a full-height sheet sliding past; it still
      // needs to end up in the right place, so it just gets there.
      translateY.setValue(nextY);
      liveY.current = nextY;
      return;
    }

    Animated.spring(translateY, {
      toValue: nextY,
      // Bounce is earned here: the sheet only overshoots because the user's own
      // flick carried it there. A sheet that wobbles on a tap would be a toy.
      ...springConfig(motion.spring.sheet, { velocity }),
    }).start();
  }, [translateY, reduceMotion]);

  const panResponder = useMemo(() => {
    const snapPoints = [0, maxY] as const;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => (
        Math.abs(g.dy) > DRAG_THRESHOLD || Math.abs(g.dx) > DRAG_THRESHOLD
      ),
      onPanResponderGrant: () => {
        // Take over from whatever is animating, starting from the pixels the
        // user is actually looking at. `stopAnimation` reports the exact
        // presented value but has to ask the native driver, so it lands a tick
        // late — the listener-fed mirror covers the first frame, and this
        // corrects it.
        startY.current = liveY.current;
        translateY.stopAnimation((current) => {
          liveY.current = current;
          startY.current = current;
        });
      },
      onPanResponderMove: (_, g) => {
        // 1:1 with the finger between the snap points, with progressive
        // resistance past either end.
        const nextY = clampWithResistance(startY.current + g.dy, 0, maxY, expandedHeight);
        liveY.current = nextY;
        translateY.setValue(nextY);
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) < TAP_SLOP && Math.abs(g.dx) < TAP_SLOP) {
          // Tap the handle to toggle — the affordance everyone tries first.
          animateTo(liveY.current > maxY / 2 ? 0 : maxY);
          return;
        }
        const velocity = toVelocityPerSecond(g.vy);
        animateTo(settleTarget(liveY.current, velocity, snapPoints), velocity);
      },
      onPanResponderTerminate: (_, g) => {
        const velocity = toVelocityPerSecond(g.vy);
        animateTo(settleTarget(liveY.current, velocity, snapPoints), velocity);
      },
    });
  }, [maxY, expandedHeight, translateY, animateTo]);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: expandedHeight,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
          // shadow.raised casts DOWNWARD (offset +16y), which on a sheet
          // anchored to the bottom edge is thrown entirely off-screen — the
          // sheet read as a flat block with no separation from the map. Same
          // warm tint, aimed up.
          shadowColor: shadowTint.color,
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: -8 },
          elevation: 16,
        },
        {
          transform: [{ translateY }],
        },
      ]}
    >
      {/* Generous vertical padding: this is the ONLY draggable surface on the
          sheet, so it has to be findable with a thumb, not just visible. */}
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: 0, right: 0 }}
        style={{ paddingTop: spacing.md, paddingBottom: spacing.md, alignItems: 'center' }}
      >
        <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong }} />
      </View>
      {children}
    </Animated.View>
  );
}
