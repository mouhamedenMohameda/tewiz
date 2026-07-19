/**
 * @bacons/apple-targets config for the ride Live Activity widget extension.
 *
 * `type: 'widget'` makes @bacons/apple-targets generate a WidgetKit extension
 * target (Info.plist with the widgetkit-extension point, build phases, signing)
 * during `expo prebuild`. Its bundle id is derived from the main app
 * (<mainBundleId>.RideActivity). ActivityKit needs iOS 16.2, so the extension
 * is pinned there even though the app supports older iOS.
 */
module.exports = {
  type: 'widget',
  name: 'RideActivity',
  deploymentTarget: '16.2',
};
