const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Config plugin that gives Android the pieces needed to pop a full-screen
 * "incoming ride" screen over the lock screen (like an incoming call):
 *
 *   1. USE_FULL_SCREEN_INTENT — required to post a notification with a
 *      fullScreenIntent. On Android <14 declaring it here is enough (granted at
 *      install). On Android 14+ it is auto-granted only for apps categorised as
 *      calling/alarm; otherwise the notification gracefully degrades to a
 *      heads-up banner unless the user enables it in system settings.
 *   2. WAKE_LOCK — lets the launched activity wake the screen.
 *   3. MainActivity flags showWhenLocked / turnScreenOn — so the activity the
 *      notification launches can appear on top of the keyguard and turn the
 *      screen on.
 *
 * iOS is untouched: it cannot auto-launch UI from the background, so it keeps
 * the classic notification (tap-to-open) handled by expo-notifications.
 */
const withRideFullScreenIntent = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    // 1 + 2. Permissions (idempotent — don't duplicate on re-runs).
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const perms = manifest.manifest['uses-permission'];
    const ensurePerm = (name) => {
      if (!perms.some((p) => p.$ && p.$['android:name'] === name)) {
        perms.push({ $: { 'android:name': name } });
      }
    };
    ensurePerm('android.permission.USE_FULL_SCREEN_INTENT');
    ensurePerm('android.permission.WAKE_LOCK');

    // 3. MainActivity flags.
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    mainActivity.$['android:showWhenLocked'] = 'true';
    mainActivity.$['android:turnScreenOn'] = 'true';

    return cfg;
  });
};

module.exports = withRideFullScreenIntent;
