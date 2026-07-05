/**
 * SplashScreen — "Lever de Soleil"
 *
 * Minimal cinematic splash: warm gradient → logo fades in with a soft
 * radial glow → brand name types on → a single golden horizon line
 * sweeps across → multilingual taglines cascade in → everything fades.
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
import { colors, spacing } from '@/theme';

interface SplashScreenProps {
  onAnimationEnd?: () => void;
  duration?: number;
}

const { width: W, height: H } = Dimensions.get('window');

const LINES = [
  { code: 'FR', text: 'Plus vite, plus serein, partout a Nouakchott.' },
  { code: 'EN', text: 'Move with confidence. Arrive with ease.' },
  { code: 'AR', text: 'ألو رفيق دربك وصوت أمانك', rtl: true },
  { code: 'WO', text: 'Demal ak jamm, agsi bu gaaw te yomb.' },
] as const;

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onAnimationEnd,
}) => {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const glowScale = useRef(new Animated.Value(0.4)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const nameY = useRef(new Animated.Value(12)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const horizonWidth = useRef(new Animated.Value(0)).current;
  const horizonOpacity = useRef(new Animated.Value(0)).current;
  const lineAnims = useRef(LINES.map(() => ({
    opacity: new Animated.Value(0),
    y: new Animated.Value(16),
  }))).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Gentle glow pulse
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

    Animated.sequence([
      // Phase 1: Logo materialises (0 → 1s)
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

      // Phase 2: Brand name + tagline (0.7s → 1.6s)
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
        Animated.sequence([
          Animated.delay(200),
          Animated.timing(taglineOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // Phase 3: Horizon line sweeps (1.6s → 2.2s)
      Animated.parallel([
        Animated.timing(horizonOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(horizonWidth, {
          toValue: 1,
          duration: 600,
          useNativeDriver: false,
        }),
      ]),

      // Phase 4: Multilingual lines cascade (2.2s → 3s)
      Animated.stagger(
        100,
        lineAnims.map(({ opacity, y }) =>
          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }),
            Animated.timing(y, {
              toValue: 0,
              duration: 350,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),

      // Phase 5: Hold, then fade (3s → 4s)
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 800,
        delay: 600,
        useNativeDriver: false,
      }),
    ]).start(() => {
      glowPulse.stop();
      onAnimationEnd?.();
    });

    return () => glowPulse.stop();
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

      {/* Warm radial accent — bottom left */}
      <View style={styles.accentBL} />
      {/* Warm radial accent — top right (subtler) */}
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
        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          Au bout du fil le bout du monde
        </Animated.Text>
      </Animated.View>

      {/* Horizon line */}
      <Animated.View
        style={[
          styles.horizon,
          {
            opacity: horizonOpacity,
            width: horizonWidth.interpolate({
              inputRange: [0, 1],
              outputRange: [0, W * 0.6],
            }),
          },
        ]}
      />

      {/* Multilingual taglines */}
      <View style={styles.linesWrap}>
        {LINES.map((line, i) => (
          (() => {
            const anim = lineAnims[i]!;
            return (
              <Animated.View
                key={line.code}
                style={[
                  styles.lineRow,
                  {
                    opacity: anim.opacity,
                    transform: [{ translateY: anim.y }],
                  },
                ]}
              >
                <Text style={styles.lineText}>
                  {line.text}
                </Text>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeText}>{line.code}</Text>
                </View>
              </Animated.View>
            );
          })()
        ))}
      </View>
    </Animated.View>
  );
};

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
    top: H * 0.28 - 60,
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
    top: H * 0.28,
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
    top: H * 0.28 + 96 + 20,
    alignItems: 'center',
  },

  brandName: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.ink,
  },

  tagline: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.8,
    color: colors.ink2,
    textTransform: 'uppercase',
  },

  horizon: {
    position: 'absolute',
    top: H * 0.28 + 96 + 20 + 70,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.saffron,
    shadowColor: colors.saffron,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  linesWrap: {
    position: 'absolute',
    bottom: H * 0.1,
    width: W,
    paddingHorizontal: spacing.xl,
    gap: 8,
  },

  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(44, 29, 16, 0.06)',
    gap: 10,
  },

  lineText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.ink,
    letterSpacing: 0.2,
  },

  codeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.ember,
  },

  codeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onEmber,
    letterSpacing: 0.6,
  },
});

export default SplashScreen;
