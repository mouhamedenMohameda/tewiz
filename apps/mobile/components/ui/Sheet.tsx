/**
 * Sheet — the app's one modal bottom sheet.
 *
 *   <Sheet visible={open} onClose={close} title="…">…</Sheet>
 *
 * Sixteen screens used to each hand-roll a `<Modal transparent>` with their own
 * scrim colour, their own corner radius and whichever of `animationType="fade"`
 * or `"slide"` the author happened to pick that day. Things that look the same
 * have to behave the same, or people can't predict what a tap will do — so this
 * is the single implementation.
 *
 * The behaviour it standardises:
 *
 *  - It ENTERS AND LEAVES ALONG THE SAME PATH. It rises from the bottom edge
 *    and it goes back down to the bottom edge. A panel that slides in from one
 *    place and vanishes into another breaks the sense that the thing you
 *    dismissed is the thing you opened. (`animationType="fade"` on a sheet that
 *    is visually anchored to the bottom is exactly that mismatch.)
 *  - It is DRAGGABLE, and the drag is 1:1 with the finger, rubber-banding if
 *    you pull it upward past its resting place.
 *  - Releasing it PROJECTS the flick forward to decide dismiss-vs-return, then
 *    hands the release velocity to the spring, so the sheet keeps moving at the
 *    speed your finger left it at rather than restarting from zero.
 *  - The scrim DIMS TO FOCUS: this is a blocking decision, so the context
 *    behind it is pushed back rather than left competing for attention. The dim
 *    tracks the drag, so pulling the sheet down brightens the app underneath
 *    continuously — you can see what you're returning to before you commit.
 *  - Under Reduce Motion the travel is replaced by a cross-fade.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, currentScheme, motion, radius, schemed, shadowTint, spacing, type as typo } from '@/theme';
import {
  rubberband,
  project,
  springConfig,
  toVelocityPerSecond,
} from '@/lib/motion';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { haptics } from '@/lib/haptics';
import { AppText } from './Text';

/**
 * Warm scrim — the cold slate one belonged to the pre-"Sahara Solaire" look.
 * Dark mode needs a deeper one: a 45%-espresso wash over an already-espresso
 * app barely registers, so the sheet would stop reading as "in front".
 */
const scrim = schemed(() => ({
  // Not `value` — see the note on shadowTint in theme/index.ts.
  color: currentScheme() === 'dark' ? 'rgba(0,0,0,0.62)' : 'rgba(42,26,14,0.45)',
})) as { color: string };
/** Past this fraction of the sheet's height, a release dismisses. */
const DISMISS_FRACTION = 0.4;
const TAP_SLOP = 4;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /**
   * Allow drag-down and backdrop-tap to dismiss. Turn off only when the sheet
   * is a decision the user genuinely has to make — not merely an important one.
   */
  dismissible?: boolean;
  /** Fraction of the screen the sheet may grow to. */
  maxHeightRatio?: number;
  /**
   * Lift the sheet above the keyboard. On by default — a sheet is anchored to
   * the bottom edge, which is exactly where the keyboard appears, so any sheet
   * containing an input needs this. Turn it off only for a sheet that has no
   * text entry and whose height you want held perfectly still.
   */
  avoidKeyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Sheet({
  visible,
  onClose,
  children,
  title,
  subtitle,
  dismissible = true,
  maxHeightRatio = 0.78,
  avoidKeyboard = true,
  contentStyle,
}: SheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  // Kept mounted for the length of the exit, so the sheet can animate OUT
  // instead of being yanked off the screen the instant state flips.
  const [rendered, setRendered] = useState(visible);

  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const fade = useRef(new Animated.Value(0)).current;
  /** Live on-screen offset, so a gesture can grab the sheet mid-animation. */
  const liveY = useRef(screenHeight);
  const startY = useRef(0);
  /** Measured once laid out; until then we travel the full screen height. */
  const sheetHeight = useRef(screenHeight);

  useEffect(() => {
    const id = translateY.addListener(({ value }) => { liveY.current = value; });
    return () => translateY.removeListener(id);
  }, [translateY]);

  const animateOpen = useCallback((velocity = 0) => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1, duration: motion.base, useNativeDriver: true,
      }),
      reduceMotion
        ? Animated.timing(translateY, {
            toValue: 0, duration: motion.reducedFade, useNativeDriver: true,
          })
        : Animated.spring(translateY, {
            toValue: 0,
            // A sheet you threw is allowed a little overshoot; one that merely
            // opened is not, so the entrance is critically damped and only the
            // gesture-driven return keeps the bounce.
            ...springConfig(
              velocity ? motion.spring.sheet : motion.spring.enter,
              { velocity },
            ),
          }),
    ]).start();
  }, [fade, translateY, reduceMotion]);

  const animateClosed = useCallback((velocity = 0) => {
    const target = sheetHeight.current;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 0,
        duration: reduceMotion ? motion.reducedFade : motion.base,
        useNativeDriver: true,
      }),
      reduceMotion
        ? Animated.timing(translateY, {
            toValue: target, duration: motion.reducedFade, useNativeDriver: true,
          })
        : Animated.spring(translateY, {
            toValue: target,
            // Critically damped on the way out: nothing should bounce as it
            // leaves, there is nothing left to land on.
            ...springConfig({ response: 0.3, dampingRatio: 1 }, { velocity }),
          }),
    ]).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [fade, translateY, reduceMotion]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      translateY.setValue(sheetHeight.current);
      liveY.current = sheetHeight.current;
      animateOpen();
    } else if (rendered) {
      animateClosed();
    }
    // `rendered` is intentionally not a dependency: it is this effect's own
    // output, and reacting to it would re-run the entrance on every mount flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, animateOpen, animateClosed, translateY]);

  // The PanResponder is created once — recreating it mid-drag drops the
  // gesture — so its handlers reach current props through refs rather than
  // closing over the first render's values.
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  const animateOpenRef = useRef(animateOpen);
  dismissibleRef.current = dismissible;
  onCloseRef.current = onClose;
  animateOpenRef.current = animateOpen;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => dismissibleRef.current,
      onMoveShouldSetPanResponder: (_, g) => dismissibleRef.current && Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        // Start from the pixels on screen, not from the value we were heading
        // for — otherwise catching a sheet mid-animation makes it jump.
        startY.current = liveY.current;
        translateY.stopAnimation((current) => {
          liveY.current = current;
          startY.current = current;
        });
      },
      onPanResponderMove: (_, g) => {
        const raw = startY.current + g.dy;
        // Down is free (you're dismissing); up resists, because there is
        // nothing above the sheet's resting place to reveal.
        const next = raw < 0 ? -rubberband(-raw, sheetHeight.current) : raw;
        liveY.current = next;
        translateY.setValue(next);
        fade.setValue(1 - Math.min(1, Math.max(0, next / sheetHeight.current)));
      },
      onPanResponderRelease: (_, g) => {
        const velocity = toVelocityPerSecond(g.vy);
        if (Math.abs(g.dy) < TAP_SLOP && Math.abs(g.dx) < TAP_SLOP) {
          animateOpenRef.current(0);
          return;
        }
        // Where would this flick have ended up if we just let it decelerate?
        // Deciding from the release POINT alone makes a fast short flick spring
        // back, which reads as the sheet refusing you.
        const projected = liveY.current + project(velocity);
        if (projected > sheetHeight.current * DISMISS_FRACTION) {
          haptics.impact();
          onCloseRef.current();
        } else {
          animateOpenRef.current(velocity);
        }
      },
      onPanResponderTerminate: () => animateOpenRef.current(0),
    }),
  ).current;

  if (!rendered) return null;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      // Android hardware back. A non-dismissible sheet swallows it rather than
      // leaving the prop off, which RN treats as "no handler at all".
      onRequestClose={dismissible ? onClose : () => {}}
    >
      <View style={{ flex: 1 }}>
        {/* The scrim sits OUTSIDE the keyboard-avoiding view on purpose: it has
            to stay full-bleed. Inside, the avoider's padding would inset it and
            leave a bright strip along the bottom edge as the keyboard opens. */}
        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: scrim.color,
            opacity: fade,
          }}
        >
          {dismissible ? (
            <Pressable
              style={{ flex: 1 }}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
          ) : null}
        </Animated.View>

        <KeyboardAvoidingView
          // Matches what the screens that hand-rolled this were already doing.
          behavior={avoidKeyboard ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
          pointerEvents="box-none"
        >
        <Animated.View
          onLayout={(e) => { sheetHeight.current = e.nativeEvent.layout.height; }}
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xxl,
              borderTopRightRadius: radius.xxl,
              maxHeight: screenHeight * maxHeightRatio,
              paddingBottom: insets.bottom + spacing.lg,
              // Aimed upward: a sheet welded to the bottom edge throws a
              // downward shadow clean off the screen and reads as flat.
              shadowColor: shadowTint.color,
              shadowOpacity: 0.2,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: -10 },
              elevation: 20,
            },
            reduceMotion
              ? { opacity: fade }
              : { transform: [{ translateY }] },
          ]}
        >
          {/* The grab area. Only the handle and header drag, so a list inside
              the sheet scrolls without wrestling the sheet for the gesture. */}
          <View
            {...panResponder.panHandlers}
            accessibilityRole={dismissible ? 'adjustable' : undefined}
            style={{ paddingTop: spacing.md, paddingHorizontal: spacing.lg }}
          >
            {dismissible ? (
              <View style={{ alignItems: 'center', paddingBottom: spacing.sm }}>
                <View style={{
                  width: 44, height: 5, borderRadius: 3,
                  backgroundColor: colors.lineStrong,
                }} />
              </View>
            ) : null}

            {title ? (
              <AppText style={{ ...typo.h2, color: colors.ink, marginTop: spacing.xs }}>
                {title}
              </AppText>
            ) : null}
            {subtitle ? (
              <AppText style={{ ...typo.body, color: colors.ink2, marginTop: spacing.xs }}>
                {subtitle}
              </AppText>
            ) : null}
          </View>

          {/* flexShrink lets a ScrollView inside resolve a bounded height
              against the sheet's maxHeight instead of overflowing it. */}
          <View style={[
            { paddingHorizontal: spacing.lg, paddingTop: spacing.base, flexShrink: 1 },
            contentStyle,
          ]}>
            {children}
          </View>
        </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
