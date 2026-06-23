import type { ExpoConfig } from 'expo/config';
import brand from './brand.json';

// Single source of truth for the brand lives in ./brand.json (see lib/brand.ts).
const APP_NAME = brand.name;
const APP_SLUG = brand.slug;
const APP_SCHEME = brand.scheme;
const BUNDLE_ID = brand.bundleId;

/**
 * Expo config is dynamic so the app name comes from the single source of
 * truth in ./lib/brand.ts. Rebrand = change APP_NAME there, nothing here.
 */
const config: ExpoConfig = {
  name: APP_NAME,
  slug: APP_SLUG,
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  scheme: APP_SCHEME,
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: BUNDLE_ID,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Pour commander une course et — en mode chauffeur — recevoir des courses proches.',
      // No NSLocationAlwaysAndWhenInUseUsageDescription: the app only uses
      // foreground location (getCurrentPositionAsync). Declaring Always
      // without runtime usage triggers App Store rejection under
      // guideline 5.1.1 (data collection scope).
      NSCameraUsageDescription:
        'Pour prendre les photos requises pour votre dossier de chauffeur.',
      NSPhotoLibraryUsageDescription:
        'Pour joindre vos documents à votre dossier de chauffeur.',
      NSMicrophoneUsageDescription:
        'Pour dicter votre départ et votre destination par la voix (en français, hassaniya ou arabe).',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F2682C',
    },
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
    ],
    // Required for react-native-maps with PROVIDER_DEFAULT/PROVIDER_GOOGLE on
    // Android. Without this the MapView activity crashes natively ("App
    // stopped") the first time it tries to render. The key is injected at
    // build time from the EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY env var (set
    // in eas.json per profile) — restrict the key to the app's package name
    // + SHA-1 in Google Cloud Console.
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
      },
    },
  },
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    // Crash reporting. Plugin is harmless when no DSN is set at runtime —
    // it wires the native bridge and source-map upload hooks; the runtime
    // init in lib/sentry.ts no-ops without EXPO_PUBLIC_SENTRY_DSN.
    '@sentry/react-native/expo',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#FBF3E7',
      },
    ],
    [
      'expo-location',
      {
        // Foreground-only — see comment on NSLocationWhenInUseUsageDescription
        // above. Switch to `locationAlwaysAndWhenInUsePermission` only if we
        // actually start a background TaskManager for ride tracking.
        locationWhenInUsePermission: `${APP_NAME} utilise votre position pour commander ou — en mode chauffeur — recevoir des courses.`,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: `${APP_NAME} a besoin d'accéder à vos photos pour votre dossier de chauffeur.`,
        cameraPermission: `${APP_NAME} a besoin de la caméra pour photographier vos documents et votre véhicule.`,
      },
    ],
    'expo-notifications',
    [
      'expo-av',
      {
        microphonePermission: `${APP_NAME} utilise le micro pour dicter votre départ et votre destination.`,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          extractNativeLibs: true,
          useLegacyPackaging: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: '5888957f-74bd-4a38-9dce-77f46a124cc7',
    },
  },
};

export default config;
