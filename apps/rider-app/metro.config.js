const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// macOS Sequoia + Desktop folder + Full Disk Access combo makes FSEvents fail.
// Force Metro to use Node's polling-based crawler instead of Watchman.
config.resolver.unstable_enablePackageExports = true;
config.watcher = {
  ...(config.watcher ?? {}),
  watchman: false,
};

module.exports = config;
