import type { ExpoConfig } from 'expo/config';
import { existsSync } from 'fs';
import brand from './brand.json';

// Single source of truth for the brand lives in ./brand.json (see lib/brand.ts).
const APP_NAME = brand.name;
const APP_SLUG = brand.slug;
const APP_SCHEME = brand.scheme;
const BUNDLE_ID = brand.bundleId;

// Android push (FCM) needs google-services.json baked into the build. We only
// wire it when the file is actually present (env override or the default path)
// so builds keep working before Firebase is set up. Without it, Expo push
// token registration warns "Default FirebaseApp is not initialized" and Android
// push stays disabled — the app itself still runs fine.
const GOOGLE_SERVICES_FILE =
  process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const HAS_GOOGLE_SERVICES = existsSync(GOOGLE_SERVICES_FILE);

// The iOS Live Activity widget target is wired via @bacons/apple-targets (reads
// ./targets/rideactivity). Only enable the plugin once the dep is installed so
// `expo start` / config eval keeps working before `npx expo install
// @bacons/apple-targets` is run. Same defensive pattern as HAS_GOOGLE_SERVICES.
const HAS_APPLE_TARGETS = existsSync('./node_modules/@bacons/apple-targets');

/**
 * Expo config is dynamic so the app name comes from the single source of
 * truth in ./lib/brand.ts. Rebrand = change APP_NAME there, nothing here.
 */
const config: ExpoConfig = {
  name: APP_NAME,
  slug: APP_SLUG,
  version: '1.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  scheme: APP_SCHEME,
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: BUNDLE_ID,
    entitlements: {
      // Time Sensitive Notifications capability. Required for the "new ride"
      // push (interruptionLevel: 'time-sensitive', set in the API's expo-push.ts)
      // to break through Focus / Do-Not-Disturb and light the lock screen —
      // the conformant iOS stand-in for Android's full-screen incoming-ride
      // intent. Unlike Critical Alerts, this needs no Apple approval.
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Pour commander une course et — en mode Captain — recevoir des courses proches.',
      // Background location (Level B): a captain who is ONLINE shares their
      // position continuously so the support/back-office can see and replay
      // their route, even when the app is backgrounded. Only active while
      // online; stops on offline. This backs the Always usage declaration
      // below (App Store guideline 5.1.1 — the runtime usage now exists).
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'En mode Captain en ligne, votre position est partagée en continu avec le support pour la sécurité et le suivi de vos trajets, même en arrière-plan.',
      // Allow location delivery while backgrounded.
      UIBackgroundModes: ['location'],
      NSCameraUsageDescription:
        'Pour prendre les photos requises pour votre dossier de Captain.',
      NSPhotoLibraryUsageDescription:
        'Pour joindre vos documents à votre dossier de Captain.',
      NSMicrophoneUsageDescription:
        'Pour dicter votre départ et votre destination par la voix (en français, hassaniya ou arabe).',
      // Enables the ride Live Activity (course en cours) on the lock screen and
      // Dynamic Island. Widget UI lives in ./targets/rideactivity, driven by the
      // local Expo module in ./modules/live-activity (see lib/liveActivity.ts).
      NSSupportsLiveActivities: true,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    ...(HAS_GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F2682C',
    },
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      // Background tracking (Level B) while the captain is online.
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.CAMERA',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
    ],
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
        locationWhenInUsePermission: `${APP_NAME} utilise votre position pour commander ou — en mode Captain — recevoir des courses.`,
        // Level B background tracking: a background TaskManager collects the
        // online captain's location for the back-office route view. This turns
        // on the Android background-location + foreground-service wiring and the
        // iOS Always permission string.
        locationAlwaysAndWhenInUsePermission: `${APP_NAME}, en mode Captain en ligne, partage votre position en continu avec le support, même en arrière-plan.`,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: `${APP_NAME} a besoin d'accéder à vos photos pour votre dossier de Captain.`,
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
    [
      // Mapbox native SDK. The download token is a SECRET token (sk.*) with
      // scope `downloads:read` — needed at *build* time to fetch the Android
      // SDK from Mapbox's authenticated maven. The runtime *public* token
      // (EXPO_PUBLIC_MAPBOX_TOKEN) is set via MapboxGL.setAccessToken() in
      // lib/mapbox.ts so it can be restricted per platform / bundle ID.
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN,
      },
    ],
    // Android: permission + activity flags so a new ride can pop a full-screen
    // "incoming call"-style screen over the lock screen (see
    // lib/fullScreenRideAlert.ts). No-op on iOS.
    './plugins/withRideFullScreenIntent',
    // iOS: build the ride Live Activity widget extension from ./targets/rideactivity.
    // Guarded so config still evaluates before the dep is installed.
    ...(HAS_APPLE_TARGETS ? ['@bacons/apple-targets' as const] : []),
  ],
  experiments: {
    typedRoutes: true,
  },
  owner: 'usernamem',
  extra: {
    router: {},
    eas: {
      projectId: '5888957f-74bd-4a38-9dce-77f46a124cc7',
    },
  },
};

export default config;
