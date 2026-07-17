/**
 * SplashScreen — "Lever de Soleil"
 *
 * Minimal cinematic splash: warm gradient → logo fades in with a soft
 * radial glow → brand name and Arabic slogan bloom in the app's own
 * typefaces → a car drives in on the horizon → everything fades.
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
import { colors } from '@/theme';

interface SplashScreenProps {
  onAnimationEnd?: () => void;
  duration?: number;
}

const { width: W, height: H } = Dimensions.get('window');

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
  const horizonWidth = useRef(new Animated.Value(0)).current;
  const horizonOpacity = useRef(new Animated.Value(0)).current;
  const carX = useRef(new Animated.Value(-W)).current;
  const carOpacity = useRef(new Animated.Value(0)).current;
  const carBounce = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const glowPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.5,
          duration: 1200,
          useNativeDriver: false,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.25,
          duration: 1200,
          useNativeDriver: false,
        }),
      ]),
    );
    glowPulse.start();

    // Subtle car bob while it's on-screen
    const carBob = Animated.loop(
      Animated.sequence([
        Animated.timing(carBounce, {
          toValue: -3,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(carBounce, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );

    Animated.sequence([
      // Phase 1: Logo materialises
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: false,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          damping: 14,
          stiffness: 100,
          mass: 0.8,
          useNativeDriver: false,
        }),
        Animated.timing(glowScale, {
          toValue: 1,
          duration: 900,
          useNativeDriver: false,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: false,
        }),
      ]),

      // Phase 2: Brand name
      Animated.parallel([
        Animated.timing(nameOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(nameY, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),

      // Phase 3: Slogan blooms
      Animated.parallel([
        Animated.timing(sloganOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.spring(sloganScale, {
          toValue: 1,
          damping: 12,
          stiffness: 90,
          useNativeDriver: true,
        }),
      ]),

      // Phase 4: Horizon line sweeps
      Animated.parallel([
        Animated.timing(horizonOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(horizonWidth, {
          toValue: 1,
          duration: 700,
          useNativeDriver: false,
        }),
      ]),

      // Phase 5: Car drives in on the horizon
      Animated.parallel([
        Animated.timing(carOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(carX, {
          toValue: 0,
          damping: 16,
          stiffness: 80,
          mass: 1,
          useNativeDriver: true,
        }),
      ]),

      // Phase 6: Hold, then fade
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 800,
        delay: 5300,
        useNativeDriver: false,
      }),
    ]).start(() => {
      glowPulse.stop();
      carBob.stop();
      onAnimationEnd?.();
    });

    // Start the bob shortly after the car appears
    const bobDelay = setTimeout(() => carBob.start(), 3200);

    return () => {
      glowPulse.stop();
      carBob.stop();
      clearTimeout(bobDelay);
    };
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      <LinearGradient
        colors={['#FBF3E7', '#F6E4C8', '#EDCFA6', '#D4A76A']}
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

      {/* Horizon line — the road */}
      <Animated.View
        style={[
          styles.horizon,
          {
            opacity: horizonOpacity,
            width: horizonWidth.interpolate({
              inputRange: [0, 1],
              outputRange: [0, W * 0.9],
            }),
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
            transform: [
              { translateX: carX },
              { translateY: carBounce },
            ],
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
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#5A3414',
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
    fontSize: 34,
    lineHeight: 48,
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: 24,
    writingDirection: 'rtl',
  },

  horizon: {
    position: 'absolute',
    top: HORIZON_TOP,
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
    bottom: 28,
    width: W,
    fontFamily: 'Cairo_700Bold',
    fontSize: 20,
    lineHeight: 30,
    color: colors.muted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});

export default SplashScreen;
