import type { ExpoConfig } from 'expo/config';
import { existsSync } from 'fs';
import brand from './brand.json';

// Single source of truth for the brand lives in ./brand.json (see lib/brand.ts).
const APP_NAME = brand.name;
const APP_SLUG = brand.slug;
const APP_SCHEME = brand.scheme;
const BUNDLE_ID = brand.bundleId;

// Android push (FCM) needs google-services.json baked into the build. The file
// is committed to the repo, so wire it UNCONDITIONALLY — NO existsSync gate.
//
// History of pain (2026-07): the previous versions gated googleServicesFile
// behind existsSync(...). Whenever that check returned false on EAS (CWD /
// __dirname surprises, or the file simply not resolving), googleServicesFile was
// silently dropped → the com.google.gms:google-services gradle plugin was never
// applied → the shipped APK had NO Firebase → getExpoPushTokenAsync threw
// E_REGISTRATION_FAILED → no Android push token registered → Android push died
// silently while iOS (APNs, no Firebase) kept working. Confirmed on-device via
// `adb logcat`: "Default FirebaseApp is not initialized ... google-services was
// not applied".
//
// Setting it unconditionally removes every silent-drop path: Expo resolves this
// against the project root, and a genuinely-missing file now makes the BUILD
// fail loudly (the safe failure) instead of producing a broken app.
const GOOGLE_SERVICES_FILE =
  process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';

// The iOS Live Activity widget target is wired via @bacons/apple-targets (reads
// ./targets/rideactivity). Only enable the plugin once the dep is installed so
// `expo start` / config eval keeps working before it is. NOTE: under pnpm /
// workspaces the package is hoisted to the MONOREPO ROOT node_modules, not this
// package's — so check both, otherwise the widget target is silently skipped at
// prebuild even though the dep is installed.
const HAS_APPLE_TARGETS =
  existsSync('./node_modules/@bacons/apple-targets') ||
  existsSync('../../node_modules/@bacons/apple-targets');

/**
 * Expo config is dynamic so the app name comes from the single source of
 * truth in ./lib/brand.ts. Rebrand = change APP_NAME there, nothing here.
 */
const config: ExpoConfig = {
  name: APP_NAME,
  slug: APP_SLUG,
  version: '1.3.1',
  orientation: 'portrait',
  // 'automatic' hands the choice to the OS setting; the palette follows via
  // <ThemeProvider>. Locked to 'light' before, which meant useColorScheme()
  // could never report anything else no matter what the user had chosen.
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  scheme: APP_SCHEME,
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: BUNDLE_ID,
    // @bacons/apple-targets needs the Apple Team ID to sign the Live Activity
    // widget extension (its own bundle id <BUNDLE_ID>.RideActivity). Read from
    // env so it isn't hardcoded — set APPLE_TEAM_ID (your 10-char team, shown by
    // `eas credentials -p ios` or Xcode → Signing). Without it prebuild warns and
    // the extension may fail to sign at build time.
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
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
    googleServicesFile: GOOGLE_SERVICES_FILE,
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
      // Haptic feedback (lib/haptics.ts). Already present in the checked-in
      // manifest via notifee; declared here so a fresh prebuild keeps it.
      'android.permission.VIBRATE',
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
        // The NATIVE splash is drawn by the OS before any JS runs, so it can't
        // read the palette — it needs its own dark value here or a dark-mode
        // cold start flashes a sand-coloured screen before the app appears.
        // Must match palettes.dark.canvas.
        dark: { backgroundColor: '#150D06' },
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
    // Encrypted storage for auth tokens (iOS Keychain / Android Keystore).
    // See lib/secureTokens.ts.
    'expo-secure-store',
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
          // R8 : sans ces deux drapeaux, le build release ne minifie ni
          // n'obscurcit RIEN. La Play Console le remonte noir sur blanc dans
          // l'app bundle explorer : "Optimisation de l'appli : Faible",
          // "Pourcentage d'obscurcissement : 1 %", "minification : -".
          // Résultat : DEX plus gros et démarrage plus lent que nécessaire.
          //
          // `enableShrinkResourcesInReleaseBuilds` supprime en plus les
          // ressources (drawables, layouts, strings) devenues inatteignables
          // après le passage de R8 — il EXIGE la minification, d'où le couple.
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,

          // R8 élimine ce qu'il ne voit pas référencé statiquement. Tout ce qui
          // est résolu par RÉFLEXION à l'exécution doit donc être protégé
          // explicitement, sinon l'app compile parfaitement et crashe au
          // premier écran (ClassNotFoundException / NoSuchMethodError) — le
          // mode de panne classique quand on active R8 sur un projet RN.
          extraProguardRules: `
# --- Expo ---
# Les modules natifs Expo sont instanciés par réflexion via la liste générée
# ExpoModulesPackageList ; sans ce keep, expo-location / expo-notifications /
# expo-secure-store & co. disparaissent du binaire.
-keep class expo.modules.** { *; }
-keep class **.ExpoModulesPackageList { *; }

# --- Mapbox ---
# Le SDK natif charge des classes par nom (styles, sources, layers).
-keep class com.mapbox.** { *; }
-dontwarn com.mapbox.**

# --- Notifee (notifications riches / full-screen intent) ---
-keep class app.notifee.** { *; }

# --- Sentry ---
# Sans SourceFile/LineNumberTable les stack traces remontées sont illisibles.
-keepattributes SourceFile,LineNumberTable
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# --- Réflexion générale (RN bridge, annotations, génériques) ---
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# react-native-reanimated / worklets
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
`,

          // Packaging des bibliothèques natives (.so).
          //
          // ÉTAIT à `true` (+ un `extractNativeLibs: true` qui, lui, n'existe
          // même pas dans le schéma d'expo-build-properties et était donc
          // ignoré en silence). Le mode "legacy" compresse les .so dans l'APK
          // et Android doit les DÉCOMPRESSER sur le disque à l'installation :
          // l'app occupe deux fois la place et chaque démarrage passe par le
          // chargeur legacy au lieu du mappage mémoire direct.
          //
          // À `false` (le défaut d'AGP depuis la 4.2, et ce que Google
          // recommande dès minSdk 23) les .so restent alignés et non
          // compressés : chargement mappé en mémoire, démarrage plus rapide,
          // moitié moins d'espace disque. L'AAB pèse un peu plus lourd sur le
          // papier, mais Play recompresse pour la livraison — le téléchargement
          // réel ne bouge quasiment pas.
          useLegacyPackaging: false,
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
      projectId: '3c12897e-d627-4f48-86d9-1aa2260a83b2',
    },
  },
};

export default config;
