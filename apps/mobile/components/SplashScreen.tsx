/**
 * SplashScreen — "Lever de Soleil"
 *
 * Minimal cinematic splash: warm gradient → logo fades in with a soft
 * radial glow → brand name and Arabic slogan bloom in the app's own
 * typefaces → a car drives in on the horizon → everything fades.
 *
 * Two rules this file has to respect, both learned the hard way:
 *
 * 1. IT IS ON THE CRITICAL PATH. Every millisecond here is a millisecond the
 *    user stares at a logo instead of using the app. The whole sequence is
 *    budgeted at SPLASH_DURATION_MS and the phases OVERLAP (each animation
 *    carries its own `delay` inside one parallel) rather than running as a
 *    strict `Animated.sequence`. Overlapping reads as fluid; stacking reads as
 *    slow. The previous version was a rigid sequence totalling ~9.7 s that
 *    SplashGate hard-cut at 4 s, so the fade-out never even played.
 *
 * 2. EVERYTHING RUNS ON THE NATIVE DRIVER. The splash animates while the JS
 *    thread is at its busiest of the whole app lifetime (auth hydrate, /auth/me,
 *    loadAppConfig, push registration, i18n). Any `useNativeDriver: false`
 *    animation is driven from that same thread — it stutters, AND it steals
 *    time from the startup work. That means: no animating `width`, `top`, or
 *    colors. The horizon "sweep" is a scaleX on a fixed-width bar for exactly
 *    this reason — animating its `width` would force the JS driver.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  Dimensions,
  StyleSheet,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, SHADOW } from '@/theme';

interface SplashScreenProps {
  onAnimationEnd?: () => void;
  duration?: number;
}

const { width: W, height: H } = Dimensions.get('window');

/**
 * Total wall-clock budget for the splash, from first frame to fully faded.
 * SplashGate reads this so the gate and the animation can never disagree about
 * when the brand moment is over.
 */
export const SPLASH_DURATION_MS = 1500;

/** When the closing fade starts — the last 300 ms of the budget. */
const FADE_OUT_AT = SPLASH_DURATION_MS - 300;

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onAnimationEnd,
}) => {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const glowScale = useRef(new Animated.Value(0.4)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const nameY = useRef(new Animated.Value(12)).current;
  const sloganOpacity = useRef(new Animated.Value(0)).current;
  const sloganScale = useRef(new Animated.Value(0.9)).current;
  // scaleX, not width — see rule 2 in the file header.
  const horizonScale = useRef(new Animated.Value(0)).current;
  const horizonOpacity = useRef(new Animated.Value(0)).current;
  const carX = useRef(new Animated.Value(-W)).current;
  const carOpacity = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // ONE parallel, each element carrying its own `delay`. The elements overlap
    // deliberately — the brand name starts rising while the logo is still
    // settling, the car sets off before the horizon has finished drawing. A
    // strict Animated.sequence would make each phase wait for the previous to
    // fully settle, which is what made the old splash feel interminable.
    const intro = Animated.parallel([
      // 0 → 420: logo materialises out of the glow.
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        damping: 14,
        stiffness: 180,
        mass: 0.7,
        useNativeDriver: true,
      }),
      Animated.timing(glowScale, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0.35,
        duration: 520,
        useNativeDriver: true,
      }),

      // 260 → 560: brand name rises under the logo.
      Animated.timing(nameOpacity, {
        toValue: 1,
        duration: 300,
        delay: 260,
        useNativeDriver: true,
      }),
      Animated.timing(nameY, {
        toValue: 0,
        duration: 300,
        delay: 260,
        useNativeDriver: true,
      }),

      // 400 → 780: the Arabic slogan blooms.
      Animated.timing(sloganOpacity, {
        toValue: 1,
        duration: 380,
        delay: 400,
        useNativeDriver: true,
      }),
      Animated.spring(sloganScale, {
        toValue: 1,
        damping: 13,
        stiffness: 150,
        delay: 400,
        useNativeDriver: true,
      }),

      // 520 → 1000: the road draws itself out from the centre.
      Animated.timing(horizonOpacity, {
        toValue: 1,
        duration: 160,
        delay: 520,
        useNativeDriver: true,
      }),
      Animated.timing(horizonScale, {
        toValue: 1,
        duration: 480,
        delay: 520,
        useNativeDriver: true,
      }),

      // 700 → ~1200: the car drives in along it.
      Animated.timing(carOpacity, {
        toValue: 1,
        duration: 220,
        delay: 700,
        useNativeDriver: true,
      }),
      Animated.spring(carX, {
        toValue: 0,
        damping: 18,
        stiffness: 110,
        mass: 0.9,
        delay: 700,
        useNativeDriver: true,
      }),

      // The closing fade is part of the same parallel so the whole thing lands
      // on SPLASH_DURATION_MS exactly, whatever the springs decide to do.
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 300,
        delay: FADE_OUT_AT,
        useNativeDriver: true,
      }),
    ]);

    intro.start(({ finished }) => {
      if (finished) onAnimationEnd?.();
    });

    return () => intro.stop();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      <LinearGradient
        colors={gradients.sand}
        locations={[0, 0.35, 0.65, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Warm radial accents */}
      <View style={styles.accentBL} />
      <View style={styles.accentTR} />

      {/* Glow behind logo */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      />

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoWrap,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        <Image
          source={require('@/assets/icon.png')}
          style={styles.logoImage}
        />
      </Animated.View>

      {/* Brand name */}
      <Animated.View
        style={[
          styles.brandWrap,
          {
            opacity: nameOpacity,
            transform: [{ translateY: nameY }],
          },
        ]}
      >
        <Text style={styles.brandName}>Aloo</Text>
      </Animated.View>

      {/* Slogan, sized as a real headline */}
      <Animated.Text
        style={[
          styles.slogan,
          {
            opacity: sloganOpacity,
            transform: [{ scale: sloganScale }],
          },
        ]}
      >
        كول آلوو تتعدل غايتك
      </Animated.Text>

      {/* Horizon line — the road. Fixed width, scaled on X from the centre
          outward: same sweep, but on the native driver (animating `width`
          would not be). */}
      <Animated.View
        style={[
          styles.horizon,
          {
            opacity: horizonOpacity,
            transform: [{ scaleX: horizonScale }],
          },
        ]}
      />

      {/* Car driving along the horizon */}
      <Animated.Image
        source={require('@/assets/splash-car.png')}
        resizeMode="contain"
        style={[
          styles.car,
          {
            opacity: carOpacity,
            transform: [{ translateX: carX }],
          },
        ]}
      />

      {/* Footer credit */}
      <Text style={styles.footer}>صُنع بحب ❤️ في نواكشوط، لكل الموريتانيين</Text>
    </Animated.View>
  );
};

const HORIZON_TOP = H * 0.88;
const CAR_WIDTH = W * 0.95;
// react-native-web doesn't reliably derive height from `aspectRatio` on
// Animated.Image, so the height is computed explicitly from the asset's
// own ratio (449×275) instead of relying on that CSS property.
const CAR_HEIGHT = CAR_WIDTH * (275 / 449);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    alignItems: 'center',
  },

  accentBL: {
    position: 'absolute',
    bottom: -60,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.ember,
    opacity: 0.12,
  },

  accentTR: {
    position: 'absolute',
    top: -40,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.saffron,
    opacity: 0.18,
  },

  glow: {
    position: 'absolute',
    top: H * 0.22 - 60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.ember,
    shadowColor: colors.ember,
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },

  logoWrap: {
    position: 'absolute',
    top: H * 0.22,
    width: 96,
    height: 96,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    shadowColor: SHADOW,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },

  logoImage: {
    width: 96,
    height: 96,
    resizeMode: 'cover',
  },

  brandWrap: {
    position: 'absolute',
    top: H * 0.22 + 96 + 20,
    alignItems: 'center',
  },

  brandName: {
    fontFamily: 'Sora_700Bold',
    fontSize: 42,
    letterSpacing: 1.5,
    color: colors.ink,
  },

  slogan: {
    position: 'absolute',
    top: H * 0.22 + 96 + 20 + 56,
    fontFamily: 'Cairo_700Bold',
    fontSize: 22,
    lineHeight: 34,
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: 24,
    writingDirection: 'rtl',
  },

  horizon: {
    position: 'absolute',
    top: HORIZON_TOP,
    // Laid out at full width and revealed via scaleX — see the render.
    width: W * 0.9,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.saffron,
    shadowColor: colors.saffron,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  car: {
    position: 'absolute',
    // Image includes a soft ground shadow below the wheels (~75% down is
    // where the tires touch), so the wheels — not the image edge — sit
    // just above the horizon line, with extra clearance so the shadow
    // doesn't crowd the footer credit below it.
    top: HORIZON_TOP - CAR_HEIGHT * 0.75 - 50,
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
  },

  footer: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    fontFamily: 'Cairo_700Bold',
    fontSize: 13,
    lineHeight: 20,
    color: colors.white,
    textAlign: 'center',
    writingDirection: 'rtl',
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: radius.lg,
  },
});

export default SplashScreen;
